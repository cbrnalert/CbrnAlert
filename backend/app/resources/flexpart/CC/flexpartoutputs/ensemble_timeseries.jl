module EnsembleTimeSeries

import CairoMakie
import NCDatasets
using Dates, Statistics

function nearest_coordinate(values, requested)
    isempty(values) && throw(ArgumentError("Empty spatial grid."))
    low, high = extrema(values)
    margin = length(values) > 1 ? abs(values[2] - values[1]) / 2 : 0
    low - margin <= requested <= high + margin || throw(ArgumentError("Location is outside the simulation grid."))
    values[argmin(abs.(values .- requested))]
end

"""Equally weighted member mean and percentiles at each time, excluding missing/nonfinite data."""
function summarize(series)
    isempty(series) && throw(ArgumentError("No ensemble members."))
    count = length(first(series))
    count > 0 || throw(ArgumentError("No output times."))
    all(values -> length(values) == count, series) || throw(ArgumentError("Member times do not match."))
    lower, median, upper, means = Float64[], Float64[], Float64[], Float64[]
    valid_counts = Int[]
    for time in 1:count
        values = [Float64(member[time]) for member in series
            if !ismissing(member[time]) && member[time] isa Real && isfinite(member[time])]
        isempty(values) && throw(ArgumentError("No valid member values at one or more times."))
        p10, p50, p90 = quantile(values, [0.1, 0.5, 0.9])
        push!(lower, p10); push!(median, p50); push!(upper, p90)
        push!(means, Statistics.mean(values))
        push!(valid_counts, length(values))
    end
    (; lower, median, upper, mean=means, valid_counts)
end

function read_point(file, layer, latitude, longitude, dimensions)
    isfinite(latitude) && -90 <= latitude <= 90 || throw(ArgumentError("Invalid latitude."))
    isfinite(longitude) && -180 <= longitude <= 180 || throw(ArgumentError("Invalid longitude."))
    isfile(file) || throw(ArgumentError("Output file is unavailable."))
    NCDatasets.NCDataset(file) do dataset
        variable = dataset[layer]
        names = NCDatasets.dimnames(variable)
        x_axis = findfirst(name -> lowercase(name) in ("longitude", "lon", "x"), names)
        y_axis = findfirst(name -> lowercase(name) in ("latitude", "lat", "y"), names)
        t_axis = findfirst(name -> lowercase(name) in ("time", "ti"), names)
        any(isnothing, (x_axis, y_axis, t_axis)) && throw(ArgumentError("Missing spatial or time dimensions."))
        xs = dataset[names[x_axis]][:]; ys = dataset[names[y_axis]][:]
        x = nearest_coordinate(xs, longitude); y = nearest_coordinate(ys, latitude)
        times = DateTime[]
        for time in dataset[names[t_axis]][:]
            push!(times, DateTime(time))
        end
        selectors = Any[Colon() for _ in names]
        selectors[x_axis] = findfirst(==(x), xs)
        selectors[y_axis] = findfirst(==(y), ys)
        for (axis, key) in enumerate(names)
            axis in (x_axis, y_axis, t_axis) && continue
            coordinate_values = haskey(dataset, key) ? dataset[key][:] : 1:size(variable, axis)
            value = get(dimensions, key, nothing)
            if isnothing(value)
                length(coordinate_values) == 1 || throw(ArgumentError("Select dimension $key."))
                value = first(coordinate_values)
            end
            index = findfirst(==(value), coordinate_values)
            isnothing(index) && throw(ArgumentError("Invalid value for dimension $key."))
            selectors[axis] = index
        end
        values = variable[selectors...]
        ndims(values) == 1 && length(values) == length(times) || throw(ArgumentError("Expected a time series."))
        (; times, values=vec(values), latitude=Float64(y), longitude=Float64(x))
    end
end

function collect_deterministic(file, layer, latitude, longitude, dimensions)
    sample = read_point(file, layer, latitude, longitude, dimensions)
    concentration = Float64[]
    for value in sample.values
        push!(concentration, ismissing(value) || !(value isa Real) || !isfinite(value) ? NaN : Float64(value))
    end
    any(isfinite, concentration) || throw(ArgumentError("No valid concentrations at this location."))
    (; times=sample.times, concentration, latitude=sample.latitude, longitude=sample.longitude)
end

function collect_series(output_dir, layer, latitude, longitude, dimensions)
    isfinite(latitude) && -90 <= latitude <= 90 || throw(ArgumentError("Invalid latitude."))
    isfinite(longitude) && -180 <= longitude <= 180 || throw(ArgumentError("Invalid longitude."))
    isdir(output_dir) || throw(ArgumentError("Output directory is unavailable."))
    members = filter(entry -> occursin(r"^member[1-9]\d*$", entry) && isdir(joinpath(output_dir, entry)), readdir(output_dir))
    sort!(members; by=entry -> parse(Int, entry[7:end]))
    isempty(members) && throw(ArgumentError("No ensemble member outputs."))
    series = Vector[]
    times = DateTime[]
    sampled_latitude, sampled_longitude = 0.0, 0.0
    for member in members
        files = filter(file -> endswith(file, ".nc"), readdir(joinpath(output_dir, member); join=true))
        length(files) == 1 || throw(ArgumentError("Expected one NetCDF output for $member."))
        sample = read_point(only(files), layer, latitude, longitude, dimensions)
        if isempty(series)
            times = sample.times
            sampled_latitude, sampled_longitude = sample.latitude, sample.longitude
        else
            sample.times == times || throw(ArgumentError("Member output times do not match."))
            (sample.longitude == sampled_longitude && sample.latitude == sampled_latitude) || throw(ArgumentError("Member grids do not match."))
        end
        push!(series, sample.values)
    end
    statistics = summarize(series)
    (; times, statistics..., member_count=length(members), latitude=sampled_latitude, longitude=sampled_longitude)
end

layer_unit(layer) = occursin(r"spec\d+_mr", layer) ? "ng/m³" : occursin("D_spec", layer) ? "ng/m²" : "native units"

"""Numeric data for interactive animation charts; no server-side rendering required."""
function series_payload(result; layer, ensemble)
    clean(values) = [isfinite(value) ? value : nothing for value in values]
    payload = Dict{String, Any}(
        "times" => [string(time) * "Z" for time in result.times],
        "latitude" => result.latitude, "longitude" => result.longitude,
        "unit" => layer_unit(layer), "ensemble" => ensemble)
    if ensemble
        payload["memberCount"] = result.member_count
        payload["mean"] = clean(result.mean)
        payload["median"] = clean(result.median)
        payload["lower"] = clean(result.lower)
        payload["upper"] = clean(result.upper)
    else
        payload["concentration"] = clean(result.concentration)
    end
    payload
end

const RENDER_LOCK = ReentrantLock()

function render(path, result; layer, dimensions, ensemble=true)
    lock(RENDER_LOCK) do
        unit = layer_unit(layer)
        x = Float64[]
        for time in result.times
            push!(x, Dates.datetime2unix(time))
        end
        indices = unique(round.(Int, range(1, length(x); length=min(6, length(x)))))
        tick_labels = Dates.format.(result.times[indices], dateformat"dd u HH:MM")
        height = haskey(dimensions, "height") ? " · Height: $(dimensions["height"]) m" : ""
        figure = CairoMakie.Figure(size=(1000, 470), fontsize=14)
        axis = CairoMakie.Axis(figure[1, 1];
            title=layer,
            xgridstyle=:dash, ygridstyle=:dash,
            subtitle="Grid point: $(round(result.latitude; digits=5))°, $(round(result.longitude; digits=5))°$height",
            xlabel="Time (UTC)", ylabel="Concentration ($unit)", xticks=(x[indices], tick_labels))
        if ensemble
            spread_plot = CairoMakie.band!(axis, x, result.lower, result.upper; color=(:steelblue, 0.25), label="P10–P90 spread")
            mean_plot = CairoMakie.lines!(axis, x, result.mean; color=:royalblue, linewidth=2, label="Mean")
            median_plot = CairoMakie.lines!(axis, x, result.median; color=:navy, linewidth=2, label="Median")
            # Markers also make a single available output time visible.
            CairoMakie.scatter!(axis, x, result.mean; color=:royalblue, markersize=5)
            CairoMakie.scatter!(axis, x, result.median; color=:navy, markersize=5)
            CairoMakie.axislegend(axis, [mean_plot, median_plot, spread_plot], ["Mean", "Median", "P10–P90 spread"],
                "Ensemble count = $(result.member_count)"; position=:rt)
        else
            CairoMakie.lines!(axis, x, result.concentration; color=:navy, linewidth=2, label="Concentration")
            CairoMakie.scatter!(axis, x, result.concentration; color=:navy, markersize=5)
            CairoMakie.axislegend(axis; position=:rt)
        end
        CairoMakie.save(path, figure)
        if lowercase(splitext(path)[2]) == ".svg"
            # Allow the complete chart to follow the floating panel's proportions.
            svg = replace(read(path, String), "<svg " => "<svg preserveAspectRatio=\"none\" "; count=1)
            write(path, svg)
        end
    end
    path
end

end
