module FlexpartRunsController

using Genie
using Genie.Requests
using Genie.Renderer.Json: json
using SearchLight
using SearchLight.Relationships


using Flexpart
using Dates
using NCDatasets
using MapMaths


using CbrnAlertApp: STATUS_CREATED, STATUS_FINISHED, STATUS_ONGOING, STATUS_ERRORED
using CbrnAlertApp: FLEXPART_RUNS_DIR
using CbrnAlertApp: _area

using CbrnAlertApp.Users
using CbrnAlertApp.Users: current_user
using CbrnAlertApp.FlexpartInputs
using CbrnAlertApp.FlexpartRuns
using CbrnAlertApp.FlexpartOutputs

using CbrnAlertApp: API


struct FlexpartRunException{T} <: Exception
  error::API.OpenAPI.APIModel
end
FlexpartRunException(code::AbstractString) = FlexpartRunException{Symbol(code)}(API.FlexpartRunError(;error = "The Flexpart run failed.", code))

run_error_throw(e::FlexpartRunException) = throw(Genie.Exceptions.ExceptionalResponse(json(e.error, status = 500)))

const UNAVAILABLE_METEO_EXCEPTION = FlexpartRunException("noMeteoFieldsAvailable")
const UNKNOWN_EXCEPTION = FlexpartRunException("unknownFlexpartRunError")


function _iscompleted(fpsim, log_path)
  if fpsim.simtype == Ensemble()
    all(file -> any(occursin.("CONGRATULATIONS", readlines(file))), log_path)
  else
    any(occursin.("CONGRATULATIONS", readlines(log_path)))
  end
end

function _throw_run_errors(filepath)
  if isa(filepath, Vector)
    for file in filepath
      lines = readlines(file)
      for line in lines
          if occursin("STOP NO METEO FIELDS AVAILABLE", line)
              throw(UNAVAILABLE_METEO_EXCEPTION)
          end
      end
    end
    throw(UNKNOWN_EXCEPTION)
  else
    lines = readlines(filepath)
    for line in lines
        if occursin("STOP NO METEO FIELDS AVAILABLE", line)
            throw(UNAVAILABLE_METEO_EXCEPTION)
        end
    end
    throw(UNKNOWN_EXCEPTION)
  end
end
_check_run_errors(fpsim::FlexpartSim) = joinpath(Flexpart.getpath(fpsim), "output.log")

function run()
  runtype = Genie.Router.params(:runType, "simple")

  if runtype == "simple"
    run_simple()
  else
    run_detailed()
  end
end

function run_simple()
  payload = Genie.Requests.jsonpayload()
  input_id = Genie.Router.params(:inputId)

  # Check if meteo input is ensemble or deterministic forecast/archive
  boolean_ensemble = findone(FlexpartInput, uuid=input_id).ensemble
  fprun = FlexpartRuns.create(ensemble = boolean_ensemble)
  if boolean_ensemble == true
    fpsim = Flexpart.FlexpartSim{Ensemble}(joinpath(fprun.path, "pathnames"))
    @info "Ensemble FlexpartSim created at $(Flexpart.getpath(fpsim))"
  else
    fpsim = Flexpart.FlexpartSim(joinpath(fprun.path, "pathnames"))
    @info "Deterministic FlexpartSim created at $(Flexpart.getpath(fpsim))"
  end

  fpoptions = FlexpartOption(fpsim)
  Flexpart.remove_unused_species!(fpoptions)

  # COMMAND options
  sim_start = DateTime(payload["command"]["start"])
  sim_end = DateTime(payload["command"]["end"])
  time_step = payload["command"]["timeStep"]
  output_type = payload["command"]["outputType"]
  oh_fields_path = joinpath(Flexpart.getpath(fpsim), "options/")

  # RELEASE options
  release_nb_substances = length(payload["releases"])
  release_name_substances = [payload["releases"][i]["substanceName"] for i in 1:release_nb_substances]
  release_name_substances_str = join(release_name_substances, ", ")  # If multiple releases, easier to pass together as string through Flexpart.jl, and not separate values
  release_geometry = [payload["releases"][i]["geometryName"] for i in 1:release_nb_substances]
  release_start = [DateTime(payload["releases"][i]["start"]) for i in 1:release_nb_substances]
  release_end = [DateTime(payload["releases"][i]["end"]) for i in 1:release_nb_substances]
  lon = []
  lat = []
  for i in (1:release_nb_substances)
    longit, latit = values(payload["releases"][i]["location"])
    push!(lon, longit)
    push!(lat, latit)
  end
  release_mass = [payload["releases"][i]["mass"] for i in 1:release_nb_substances]
  release_mass_per = []
  for i in 1:length(release_mass)
    m = zeros(length(release_mass))
    m[i] = release_mass[i]
    m = join(m, ", ")
    push!(release_mass_per, m)
  end
  release_height = [payload["releases"][i]["height"] for i in 1:release_nb_substances]
  release_particle = Int(floor(Flexpart.MAX_PARTICLES / release_nb_substances))
  release_boxLength = [release_geometry[i] == "Box" ? payload["releases"][i]["boxLength"] : 0 for i in 1:release_nb_substances]
  release_boxWidth = [release_geometry[i] == "Box" ? payload["releases"][i]["boxWidth"] : 0 for i in 1:release_nb_substances]
  release_boxHeight = [release_geometry[i] == "Box" ? payload["releases"][i]["boxHeight"] : 0 for i in 1:release_nb_substances]
    
  # OUTGRID options
  gridres = payload["outgrid"]["gridres"]
  area = payload["outgrid"]["area"]
  heights = payload["outgrid"]["heights"]

  # Set simulation start and end
  Flexpart.set_cmd_dates!(fpoptions, sim_start, sim_end)

  cmd = Dict(
    # Set simulation step
    :LOUTSTEP => time_step,
    :LOUTAVER => time_step,
    :LOUTSAMPLE => convert(Int64, time_step / 4),
    :LSYNCTIME => convert(Int64, time_step / 4),
    # Set netcdf output
    :IOUT => output_type + 8,
    # Set all outputs of same release in 1 array
    :IOUTPUTFOREACHRELEASE => 0,
    # Set OH fields path
    :OHFIELDS_PATH => "\"$oh_fields_path\""
  )
  merge!(fpoptions["COMMAND"][:COMMAND], cmd)

  # Set release options
  releases_control_options = Dict(
    :NSPEC => release_nb_substances,
    :SPECNUM_REL => release_name_substances_str
  )
  merge!(fpoptions["RELEASES"][:RELEASES_CTRL], releases_control_options)

  releases_options_list = Vector{AbstractDict}()  # Initialize list of dicts to collect release options for all releases without new values replacing previous ones
  for i in (1:release_nb_substances)  # Iterate through each release and collect the options
    center = LatLon(lat[i], lon[i])
    releases_options = Dict(
      :IDATE1 => Dates.format(release_start[i], "yyyymmdd"),
      :ITIME1 => Dates.format(release_start[i], "HHMMSS"),
      :IDATE2 => Dates.format(release_end[i], "yyyymmdd"),
      :ITIME2 => Dates.format(release_end[i], "HHMMSS"),
      :LON1 => (center + EastNorth(-release_boxLength[i]/2, 0)).c2[1],
      :LON2 => (center + EastNorth(release_boxLength[i]/2, 0)).c2[1],
      :LAT1 => (center + EastNorth(0, -release_boxWidth[i]/2)).c1[1],
      :LAT2 => (center + EastNorth(0, release_boxWidth[i]/2)).c1[1],
      :Z1 => (release_height[i] - release_boxHeight[i]/2),
      :Z2 => (release_height[i] + release_boxHeight[i]/2),
      :PARTS => release_particle,
      :MASS => release_mass_per[i],
      :COMMENT => "\"RELEASE $i\""
    )
    push!(releases_options_list, releases_options)
  end
  if length(releases_options_list) == 1  # If only 1 release, Flexpart.jl should treat it as a dict, not a list of dict
    merge!(fpoptions["RELEASES"][:RELEASE], releases_options_list[1])
  else
    merge!(fpoptions["RELEASES"][:RELEASE], releases_options_list)
  end

  # Set outgrid options
  area_f = _area(area)
  outgrid = Flexpart.area2outgrid(area_f, gridres)
  merge!(fpoptions["OUTGRID"][:OUTGRID], outgrid)
  fpoptions["OUTGRID"][:OUTGRID][:OUTHEIGHTS] = join(heights, ", ")

  # Save the options
  Flexpart.save(fpoptions)
  @warn "Flexpart options saved"

  # Get the input and adapt the Available file
  fpinput = findone(FlexpartInput, uuid=input_id)
  fpsim[:input] = abspath(joinpath(fpinput.path, "output"))
  avs = Available(fpsim)

  # Save the available file and the flexpart paths
  Flexpart.save(avs)
  Flexpart.save(fpsim)

  return run(fpsim, fprun) |> API.FlexpartRun |> json
end

function run_detailed()
end

function run(fpsim::FlexpartSim, fprun::FlexpartRun)
  fpoptions = FlexpartOption(fpsim)
  Flexpart.remove_unused_species!(fpoptions)
  FlexpartRuns.change_options!(fprun.name, fpoptions)

  if fprun.ensemble == true
    FlexpartRuns.change_status!(fprun.name, STATUS_ONGOING)
    Flexpart.run(fpsim)
    log_files = filter(file -> endswith(file, ".log"), readdir(Flexpart.getpath(fpsim)))
    output_path = joinpath.(Flexpart.getpath(fpsim), log_files)
  else
    output_path = joinpath(Flexpart.getpath(fpsim), "output.log")
    open(output_path, "w") do logf
      FlexpartRuns.change_status!(fprun.name, STATUS_ONGOING)
      Flexpart.run(fpsim) do stream
        # log_and_broadcast(stream, request_data["ws_info"], logf)
        line = readline(stream, keep=true)
        Base.write(logf, line)
        flush(logf)
      end
    end
  end

  if _iscompleted(fpsim, output_path)
    FlexpartRuns.change_status!(fprun.name, STATUS_FINISHED)
  else
    @info "Flexpart run with name $(fprun.name) has failed"
    FlexpartRuns.change_status!(fprun.name, STATUS_ERRORED)
    try _throw_run_errors(output_path)
    catch e
      # With this error, an output has normally been produced, so we relate it to the run.
      if e isa FlexpartRunException{:noMeteoFieldsAvailable}
        FlexpartOutputs.add!(fprun)
      end
      run_error_throw(e)
    finally
      FlexpartRuns.assign_to_user!(current_user(), fprun)
      if ENV["GENIE_ENV"] == "prod"
        rm(Flexpart.getpath(fpsim), recursive=true)
      end
    end
  end

  FlexpartRuns.assign_to_user!(current_user(), fprun)

  FlexpartOutputs.add!(fprun)

  return fprun
end

function get_runs()
  FlexpartRuns.delete_non_existing!()
  FlexpartRuns.delete_errored!()
  FlexpartOutputs.delete_non_existing!()
  # List for all Flexpart runs across accounts:
  all_fpruns = all(FlexpartRun)
  filter!(FlexpartRuns.isfinished, all_fpruns)
  all_fpruns_names = [run.name for run in all_fpruns]
  # List of Flexpart runs available on backend
  valid_runs = []
  for run in readdir(FLEXPART_RUNS_DIR)
    if !isempty(filter(x -> endswith(x, ".nc"), readdir(joinpath(FLEXPART_RUNS_DIR, run, "output"))))
      push!(valid_runs, run)
    end
  end
  if !isempty(filter(FlexpartRuns.isongoing, user_related(FlexpartRun)))   # allows user to plot on app, while Flexpart is running a simulation
    nothing
  else sort(valid_runs) != sort(all_fpruns_names)
    for new_fpdir in setdiff(valid_runs, all_fpruns_names)
      newrun = FlexpartRuns.add_existing(joinpath(FLEXPART_RUNS_DIR, new_fpdir))
      output_dir = joinpath(FLEXPART_RUNS_DIR, new_fpdir, "output")
      nc_file = joinpath(output_dir, filter(x -> endswith(x, ".nc"), readdir(output_dir))[1])
      Flexpart.add_total_depo(nc_file)
      FlexpartRuns.assign_to_user!(current_user(), newrun)
      FlexpartOutputs.add!(newrun)
    end
    fpruns = user_related(FlexpartRun)
  end
  API.FlexpartRun.(fpruns) |> json
end

function get_run()
  id = Genie.Router.params(:runId)
  fprun = FlexpartRuns._get_run(id)
  Users.@hasaccess!(fprun)
  API.FlexpartRun(fprun) |> json
end

function delete_run()
  id = Genie.Router.params(:runId)
  to_delete = findone(FlexpartRun, uuid = id)
  related_outputs = related(to_delete, FlexpartOutput)
  for out in related_outputs
      SearchLight.delete(out)
  end
  FlexpartRuns.delete!(to_delete)
  API.FlexpartRun(to_delete) |> json
end

function rename_run()
  uuid = Genie.Router.params(:runId)
  new_name = Genie.Router.params(:newName)
  to_rename = FlexpartRuns.rename!(uuid, new_name)
  to_rename_output = FlexpartOutputs.rename!(uuid)
  return API.FlexpartRun(to_rename) |> json
end

end