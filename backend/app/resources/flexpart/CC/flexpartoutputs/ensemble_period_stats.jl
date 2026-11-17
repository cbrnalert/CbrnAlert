module EnsemblePeriodStats
import NCDatasets
using Dates, Statistics

function grid_spacing(coordinates)
    length(coordinates) > 1 || throw(ArgumentError("Need at least two grid coordinates."))
    steps = diff(coordinates)
    (all(>(0), steps) || all(<(0), steps)) || throw(ArgumentError("Grid coordinates must be monotonic."))
    step = abs(last(coordinates) - first(coordinates)) / (length(coordinates) - 1)
    # FLEXPART commonly stores coordinates as Float32: decimal increments then differ slightly.
    all(value -> isapprox(abs(value), step; rtol=1e-3, atol=1e-6), steps) || throw(ArgumentError("Grid must be regular."))
    step
end

function contour_indices(mask, x_order, y_order)
    cells = Int[]
    for (row, y) in enumerate(y_order), (column, x) in enumerate(x_order)
        if mask[x,y] && (x==1 || x==size(mask,1) || y==1 || y==size(mask,2) || !mask[x-1,y] || !mask[x+1,y] || !mask[x,y-1] || !mask[x,y+1])
            push!(cells,(row-1)*length(x_order)+column-1)
        end
    end
    cells
end

"""Count each member once if it reaches the threshold in the inclusive output-time range.
A member with incomplete data is counted as valid only if an exceedance is established.
Read one spatial slice at a time, never the full ensemble/time cube.
"""
function calculate(output_dir, layer, threshold, first_time, last_time, dimensions=Dict(); arrival=false, snapshot=false)
    threshold isa Real && isfinite(threshold) && threshold > 0 || throw(ArgumentError("Threshold must be positive and finite."))
    first_time isa Integer && last_time isa Integer && 1 <= first_time <= last_time || throw(ArgumentError("Invalid time range."))
    snapshot && first_time != last_time && throw(ArgumentError("Snapshot requires one output time."))
    isdir(output_dir) || throw(ArgumentError("Output directory unavailable."))
    dimensions isa AbstractDict || throw(ArgumentError("Invalid dimensions."))
    members = filter(name -> occursin(r"^member[1-9]\d*$", name) && isdir(joinpath(output_dir, name)), readdir(output_dir))
    sort!(members; by=name -> parse(Int, name[7:end]))
    isempty(members) && throw(ArgumentError("No ensemble members."))
    reference = nothing
    member_contours = Dict{String, Any}[]
    hits = zeros(Int, 0, 0); valid = zeros(Int, 0, 0)
    arrival_samples = zeros(Float64, 0, 0)
    maximum_samples = zeros(Float64, 0, 0)
    for (member_index, member) in enumerate(members)
        files = filter(file -> endswith(file, ".nc"), readdir(joinpath(output_dir, member); join=true))
        length(files) == 1 || throw(ArgumentError("Expected one NetCDF file for $member."))
        NCDatasets.NCDataset(only(files)) do ds
            variable = ds[layer]
            names = NCDatasets.dimnames(variable)
            xa = findfirst(name -> lowercase(name) in ("longitude", "lon", "x"), names)
            ya = findfirst(name -> lowercase(name) in ("latitude", "lat", "y"), names)
            ta = findfirst(name -> lowercase(name) in ("time", "ti"), names)
            any(isnothing, (xa, ya, ta)) && throw(ArgumentError("Missing spatial/time axes."))
            xs = Float64.(ds[names[xa]][:]); ys = Float64.(ds[names[ya]][:])
            times = DateTime.(ds[names[ta]][:])
            issorted(times) && all(>(Millisecond(0)), diff(times)) || throw(ArgumentError("Output times must increase."))
            last_time <= length(times) || throw(ArgumentError("Time range outside output."))
            length(xs) > 1 && length(ys) > 1 || throw(ArgumentError("Need a two-dimensional grid."))
            if isnothing(reference)
                reference = (; xs, ys, times)
                hits = zeros(Int, length(xs), length(ys)); valid = zeros(Int, size(hits))
                arrival && (arrival_samples = fill(NaN, length(hits), length(members)))
                !arrival && (maximum_samples = fill(NaN, length(hits), length(members)))
            else
                xs == reference.xs && ys == reference.ys && times == reference.times || throw(ArgumentError("Member grids or times differ."))
            end
            selectors = Any[1 for _ in names]
            selectors[xa] = Colon(); selectors[ya] = Colon()
            for (axis, key) in enumerate(names)
                axis in (xa, ya, ta) && continue
                index = get(dimensions, key, 1)
                index isa Integer && 1 <= index <= size(variable, axis) || throw(ArgumentError("Invalid dimension $key."))
                selectors[axis] = index
            end
            exceeded = falses(size(hits)); complete = trues(size(hits))
            maxima = arrival ? nothing : fill(-Inf, size(hits))
            for time in first_time:last_time
                selectors[ta] = time
                grid = variable[selectors...]
                xa > ya && (grid = permutedims(grid))
                for cell in eachindex(grid)
                    value = grid[cell]
                    finite = !ismissing(value) && value isa Real && isfinite(value)
                    complete[cell] &= finite
                    !arrival && finite && (maxima[cell] = max(maxima[cell], value))
                    if finite && value >= threshold
                        if arrival && !exceeded[cell] && complete[cell]
                            arrival_samples[cell, member_index] = Dates.value(times[time] - times[first_time]) / 3_600_000
                        end
                        exceeded[cell] = true
                    end
                end
            end
            if !arrival
                for cell in eachindex(hits)
                    complete[cell] && (maximum_samples[cell, member_index] = maxima[cell])
                end
            end
            if snapshot
                cells = contour_indices(exceeded,sortperm(xs),reverse(sortperm(ys)))
                push!(member_contours,Dict("member"=>parse(Int,member[7:end]),"cells"=>cells))
            end
            hits .+= exceeded
            valid .+= exceeded .| complete
        end
    end
    xs = reference.xs; ys = reference.ys
    xp = sortperm(xs); yp = reverse(sortperm(ys))
    dx = grid_spacing(xs); dy = grid_spacing(ys)
    rows(values) = [[values[x, y] for x in xp] for y in yp]
    percentages = Matrix{Union{Nothing, Float64}}(undef, size(hits))
    for cell in eachindex(hits)
        percentages[cell] = valid[cell] == 0 ? nothing : 100.0 * hits[cell] / valid[cell]
    end
    result = Dict{String, Any}("values"=>rows(percentages), "counts"=>rows(hits), "validCounts"=>rows(valid),
        "memberCount"=>length(members), "width"=>length(xs), "height"=>length(ys),
        "xmin"=>minimum(xs)-dx/2, "xmax"=>maximum(xs)+dx/2,
        "ymin"=>minimum(ys)-dy/2, "ymax"=>maximum(ys)+dy/2,
        "startTime"=>string(reference.times[first_time])*"Z", "endTime"=>string(reference.times[last_time])*"Z")
    if arrival
        low = Matrix{Union{Nothing, Float64}}(nothing, size(hits))
        median = copy(low); high = copy(low); arrival_counts = zeros(Int, size(hits))
        histograms = Matrix{Vector{Vector{Int}}}(undef, size(hits))
        output_hours = [Dates.value(time - reference.times[first_time]) / 3_600_000 for time in reference.times[first_time:last_time]]
        time_index = Dict(hours => index - 1 for (index, hours) in enumerate(output_hours))
        for cell in eachindex(hits)
            values = filter(isfinite, arrival_samples[cell, :])
            arrival_counts[cell] = length(values)
            bins = Dict{Int, Int}()
            for hours in values
                index = time_index[hours]
                bins[index] = get(bins, index, 0) + 1
            end
            histograms[cell] = [Int[index, bins[index]] for index in sort!(collect(keys(bins)))]
            if !isempty(values)
                low[cell], median[cell], high[cell] = quantile(values, [0.1, 0.5, 0.9])
            end
        end
        result["analysis"] = "arrival"
        result["values"] = rows(median)
        result["arrivalLower"] = rows(low); result["arrivalUpper"] = rows(high)
        result["arrivalCounts"] = rows(arrival_counts)
        result["arrivalHistogram"] = rows(histograms)
        result["arrivalTimes"] = [string(time)*"Z" for time in reference.times[first_time:last_time]]
    else
        maxima = Matrix{Vector{Vector{Float64}}}(undef, size(hits))
        for cell in eachindex(hits)
            values = filter(isfinite, maximum_samples[cell, :])
            frequencies = Dict{Float64, Int}()
            for value in values
                frequencies[value] = get(frequencies, value, 0) + 1
            end
            maxima[cell] = [Float64[value, frequencies[value]] for value in sort!(collect(keys(frequencies)))]
        end
        result["analysis"] = snapshot ? "timestep" : "maximum"
        result[snapshot ? "concentrationValues" : "maximumValues"] = rows(maxima)
        snapshot && (result["memberContours"] = member_contours)
    end
    result
end
end
