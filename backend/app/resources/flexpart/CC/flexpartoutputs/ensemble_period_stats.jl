module EnsemblePeriodStats
import NCDatasets
using Dates

function grid_spacing(coordinates)
    length(coordinates) > 1 || throw(ArgumentError("Need at least two grid coordinates."))
    steps = diff(coordinates)
    (all(>(0), steps) || all(<(0), steps)) || throw(ArgumentError("Grid coordinates must be monotonic."))
    step = abs(last(coordinates) - first(coordinates)) / (length(coordinates) - 1)
    # FLEXPART commonly stores coordinates as Float32: decimal increments then differ slightly.
    all(value -> isapprox(abs(value), step; rtol=1e-3, atol=1e-6), steps) || throw(ArgumentError("Grid must be regular."))
    step
end

"""Count each member once if it reaches the threshold in the inclusive output-time range.
A member with incomplete data is counted as valid only if an exceedance is established.
Read one spatial slice at a time, never the full ensemble/time cube.
"""
function calculate(output_dir, layer, threshold, first_time, last_time, dimensions=Dict())
    threshold isa Real && isfinite(threshold) && threshold > 0 || throw(ArgumentError("Threshold must be positive and finite."))
    first_time isa Integer && last_time isa Integer && 1 <= first_time <= last_time || throw(ArgumentError("Invalid time range."))
    isdir(output_dir) || throw(ArgumentError("Output directory unavailable."))
    dimensions isa AbstractDict || throw(ArgumentError("Invalid dimensions."))
    members = filter(name -> occursin(r"^member[1-9]\d*$", name) && isdir(joinpath(output_dir, name)), readdir(output_dir))
    sort!(members; by=name -> parse(Int, name[7:end]))
    isempty(members) && throw(ArgumentError("No ensemble members."))
    reference = nothing
    hits = zeros(Int, 0, 0); valid = zeros(Int, 0, 0)
    for member in members
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
            last_time <= length(times) || throw(ArgumentError("Time range outside output."))
            length(xs) > 1 && length(ys) > 1 || throw(ArgumentError("Need a two-dimensional grid."))
            if isnothing(reference)
                reference = (; xs, ys, times)
                hits = zeros(Int, length(xs), length(ys)); valid = zeros(Int, size(hits))
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
            for time in first_time:last_time
                selectors[ta] = time
                grid = variable[selectors...]
                xa > ya && (grid = permutedims(grid))
                for cell in eachindex(grid)
                    value = grid[cell]
                    finite = !ismissing(value) && value isa Real && isfinite(value)
                    complete[cell] &= finite
                    if finite && value >= threshold
                        exceeded[cell] = true
                    end
                end
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
    Dict("values"=>rows(percentages), "counts"=>rows(hits), "validCounts"=>rows(valid),
        "memberCount"=>length(members), "width"=>length(xs), "height"=>length(ys),
        "xmin"=>minimum(xs)-dx/2, "xmax"=>maximum(xs)+dx/2,
        "ymin"=>minimum(ys)-dy/2, "ymax"=>maximum(ys)+dy/2,
        "startTime"=>string(reference.times[first_time])*"Z", "endTime"=>string(reference.times[last_time])*"Z")
end
end
