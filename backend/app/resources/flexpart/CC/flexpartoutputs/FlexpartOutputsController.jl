module FlexpartOutputsController

using Genie
using Genie.Requests
using Genie.Renderer.Json: json
using SearchLight
using SearchLight.Relationships

using Flexpart
using UUIDs

using JSON3
using Dates
using GeoJSON: Feature, FeatureCollection, Polygon, write
using GeoInterface
using Rasters
using GeoFormatTypes
using ArchGDAL
using ColorSchemes
using Colors
using HTTP

include("ensemble_timeseries.jl")
using .EnsembleTimeSeries

using CbrnAlertApp.FlexpartRuns
using CbrnAlertApp.FlexpartOutputs

using CbrnAlertApp: TMP_DIR_PATH

const DEFAULT_COLOR_SCHEME = ColorSchemes.jet

function _output_by_uuid(output_id)
    findone(FlexpartOutput, uuid = output_id)
end

function get_outputs()
    FlexpartOutputs.delete_non_existing!()
    run_id = Genie.Router.params(:runId)
    outputs = related(FlexpartRuns._get_run(run_id), FlexpartOutput)
    Dict.(outputs) |> json
end

function get_output()
    output_id = Genie.Router.params(:outputId)
    outfile = findone(FlexpartOutput, uuid = output_id)
    Dict(outfile) |> json
end

function get_layers()
    output_id = Genie.Router.params(:outputId)
    outfile = findone(FlexpartOutput, uuid = output_id)
    stack = RasterStack(outfile.path)
    layers = keys(stack)
    
    isspatial = Base.parse(Bool, Genie.Router.params(:spatial, "false"))

    if isspatial
        layers = filter(layers) do layer
            dim_names = name.(dims(stack[layer]))
            return (:X in dim_names) && (:Y in dim_names)
        end
    end
    layers |> json
end

_dims_to_dict(raster) = Dict(name(d) => collect(d) for d in dims(raster))

function get_dimensions()
    output_id = Genie.Router.params(:outputId)
    layername = Genie.Router.params(:layer, "")
    withhoriz = Base.parse(Bool, Genie.Router.params(:horizontal, "false"))
    outfile = findone(FlexpartOutput, uuid = output_id)
    raster = RasterStack(outfile.path)
    if layername !== ""
        raster = raster[layername]
    end
    d = _dims_to_dict(raster)
    if !withhoriz
        pop!(d, :X)
        pop!(d, :Y)
    end
    d |> json
end

function _to_dim(k, v)
    if k == "Ti"
        Ti(At(DateTime(v)))
    elseif k == "X"
        X(At(v))
    elseif k == "Y"
        Y(At(v))
    else
        Dim{Symbol(k)}(At(v))
    end
end

function _slice(path::String, layerName, zdims)
    raster = Raster(path, name = layerName; crs = EPSG(4326))
    args = [_to_dim(dname, val) for (dname, val) in zdims]
    view(raster, args...)
end

function get_slice()
    pl = jsonpayload()
    outputId = Genie.Router.params(:outputId)
    fpoutput = _output_by_uuid(outputId)
    layerName = Genie.Router.params(:layer)
    to_geojson = Genie.Router.params(:geojson, "false")
    to_geojson = Base.parse(Bool, to_geojson)
    viewed = _slice(fpoutput.path, layerName, pl)
    viewed = reverse(viewed; dims=Y)

    if to_geojson
        collection = to_geointerface(viewed)
        result = Dict{Symbol, Any}(:collection => geo2dict(collection))
        withcolors = Base.parse(Bool, Genie.Router.params(:legend, "false"))
        if withcolors
            result[:metadata] = getcolors(collection)
        end
        result |> json
    else
        _respond_tiff(viewed; trim=Genie.Router.params(:trim, "true") != "false")
        # viewed |> read |> json
    end
end

function _respond_tiff(raster; trim=true)
    filename = string(UUIDs.uuid4()) * ".tiff"
    tmpfile = joinpath(TMP_DIR_PATH, filename)
    trimmed = trim ? Rasters.trim(replace(raster, 0. => nothing)) : raster
    try
        filename = Rasters.write(tmpfile, replace(trimmed, nothing => 0.); options= Dict("COMPRESS"=>"DEFLATE"))
        Genie.Router.serve_file(filename)
    catch
        rethrow()
    finally
        if isfile(tmpfile)
            rm(tmpfile)
        end
    end
end

function to_geointerface(raster)
    if !hasdim(raster, X) || !hasdim(raster, Y) || ndims(raster) !== 2
        error("The remaining dimensions must be spatial")
    end
    dx = step(dims(raster, :X))
    dy = try
        step(dims(raster, :Y))
    catch
        dims(raster, :Y)[2] - dims(raster, :Y)[1]
    end
    coords = []
    vals = []
    read_raster = read(raster) # we get the raster into memory for faster access to the values
    for I in CartesianIndices(read_raster)
        fval = read_raster[I]
        if !(fval ≈ 0.)
            i,j = Tuple(I)
            coord = cell_coords(read_raster, i, j, dx, dy)
            # feat = Feature(poly; properties = (val = fval,))
            push!(coords, coord)
            push!(vals, fval)
        end
    end

    features = map(zip(coords, vals)) do (coord, val)
        Feature(Polygon(coordinates = [coord]); properties = (val = val,))
    end

    FeatureCollection(features)
end

function cell_coords(raster, i, j, dx, dy)
    x = dims(raster)[1][i]
    y = dims(raster)[2][j]
    x, y = convert.(Float64, [x, y])
    dx2 = dx/2
    dy2 = dy/2

    left = x - dx2; right = x + dx2; lower = y - dy2; upper = y + dy2

    [
        [left, lower],
        [left, upper],
        [right, upper],
        [right, lower],
    ]
end

function getcolors(collection)
    vals = collection.val
    minval = minimum(vals)
    maxval = maximum(vals)
    ticks = exp10.(range(log10(minval), log10(maxval), length=10))
    cbar = get(DEFAULT_COLOR_SCHEME, ticks[2:end], :extrema)
    Dict(
        :colors => '#'.*hex.(cbar),
        :ticks => ticks 
    )
end

geo2dict(collection) = JSON3.read(write(collection))

function get_ensemble_stats()
    output_id = Genie.Router.params(:outputId)
    layername = Genie.Router.params(:layer)
    payload = jsonpayload()
    timestep = payload["dims"]["Ti"]
    height = haskey(payload["dims"], "height") ? payload["dims"]["height"] : nothing
    threshold = payload["threshold"]

    # Get stats
    fprun_folder = related(_output_by_uuid(output_id), FlexpartRun)[].path
    fprun_pn = joinpath(fprun_folder, "pathnames")
    threshold_stats = Flexpart.threshold_exceedance(fprun_pn, layername, threshold, timestep, height)
    agreement = threshold_stats[:agreement]
    contours = threshold_stats[:contours]

    # Create multi-band raster with all the data
    contours_uint8 = map(m -> convert(Array{UInt8}, m), contours)
    stack_data = cat(agreement, contours_uint8...; dims=3)
    file_mean = joinpath(fprun_folder, "output/ensemble_mean.nc")
    ref_raster = Raster(file_mean, name=layername; crs=EPSG(4326))
    raster = Raster(stack_data; dims=(dims(ref_raster)[1:2]..., Band(1:size(stack_data, 3))), crs=EPSG(4326))
    raster = reverse(raster; dims=Y)
    _respond_tiff(raster)
end

function get_ensemble_timeseries()
    output = _output_by_uuid(Genie.Router.params(:outputId))
    isnothing(output) && return HTTP.Response(404, "Output not found")
    payload = jsonpayload()
    latitude = get(payload, "latitude", nothing)
    longitude = get(payload, "longitude", nothing)
    dimensions = get(payload, "dimensions", Dict())
    if !(latitude isa Real) || !(longitude isa Real) || !(dimensions isa AbstractDict)
        return HTTP.Response(400, "Enter valid coordinates and dimensions.")
    end
    run = related(output, FlexpartRun)[]
    layer = Genie.Router.params(:layer)
    format = Genie.Router.params(:format, "svg")
    format in ("svg", "json") || return HTTP.Response(400, "Unsupported time-series format.")
    tmpfile = joinpath(TMP_DIR_PATH, string(uuid4()) * ".svg")
    started = time()
    @info "Ensemble time series: reading members" output_id=Genie.Router.params(:outputId) latitude longitude
    try
        result = if run.ensemble
            EnsembleTimeSeries.collect_series(joinpath(run.path, "output"), layer, latitude, longitude, dimensions)
        else
            EnsembleTimeSeries.collect_deterministic(output.path, layer, latitude, longitude, dimensions)
        end
        if format == "json"
            return EnsembleTimeSeries.series_payload(result; layer, ensemble=run.ensemble) |> json
        end
        @info "Ensemble time series: rendering" elapsed_seconds=round(time() - started; digits=2) ensemble=run.ensemble
        EnsembleTimeSeries.render(tmpfile, result; layer, dimensions, ensemble=run.ensemble)
        @info "Ensemble time series: complete" elapsed_seconds=round(time() - started; digits=2)
        return HTTP.Response(200, ["Content-Type" => "image/svg+xml", "Cache-Control" => "no-store"], read(tmpfile))
    catch err
        if err isa ArgumentError || err isa BoundsError || err isa KeyError
            return HTTP.Response(400, "Location or dimensions are outside the available simulation data.")
        end
        @error "Ensemble time-series generation failed" exception=(err, catch_backtrace())
        return HTTP.Response(500, "Unable to generate time series.")
    finally
        isfile(tmpfile) && rm(tmpfile)
    end
end

end