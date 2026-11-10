using Test, Dates
import NCDatasets
include(joinpath(@__DIR__, "../app/resources/flexpart/CC/flexpartoutputs/ensemble_timeseries.jl"))
using .EnsembleTimeSeries

@testset "Ensemble point time series" begin
    stats = EnsembleTimeSeries.summarize([[0.0, 10.0], [10.0, 20.0], [20.0, 30.0]])
    @test stats.mean == [10.0, 20.0]
    skewed = EnsembleTimeSeries.summarize([[0.0], [0.0], [30.0]])
    @test skewed.mean == [10.0]
    @test skewed.median == [0.0]
    @test stats.median == [10.0, 20.0]
    @test stats.lower ≈ [2.0, 12.0]
    @test stats.upper ≈ [18.0, 28.0]
    @test stats.valid_counts == [3, 3]
    stats_missing = EnsembleTimeSeries.summarize([[missing, 0.0], [2.0, NaN], [4.0, 0.0]])
    @test stats_missing.mean == [3.0, 0.0]
    @test stats_missing.median == [3.0, 0.0]
    @test stats_missing.valid_counts == [2, 2]
    @test_throws ArgumentError EnsembleTimeSeries.summarize(Vector[])
    @test_throws ArgumentError EnsembleTimeSeries.summarize([[1.0], [1.0, 2.0]])
    @test_throws ArgumentError EnsembleTimeSeries.summarize([[missing], [NaN]])
    @test EnsembleTimeSeries.nearest_coordinate([1.0, 2.0, 3.0], 2.2) == 2.0
    @test EnsembleTimeSeries.nearest_coordinate([3.0, 2.0, 1.0], 2.2) == 2.0
    @test EnsembleTimeSeries.nearest_coordinate([1.0, 2.0], 0.5) == 1.0
    @test_throws ArgumentError EnsembleTimeSeries.nearest_coordinate([1.0, 2.0], 0.4)
    @test_throws ArgumentError EnsembleTimeSeries.collect_series("/nonexistent", "spec001_mr", 91, 0, Dict())
    mktempdir() do dir
        result = (; times=[DateTime(2026, 1, 1), DateTime(2026, 1, 1, 1)], stats...,
            member_count=3, latitude=50.0, longitude=4.0)
        path = joinpath(dir, "time-series.svg")
        EnsembleTimeSeries.render(path, result; layer="spec001_mr", dimensions=Dict("height"=>100))
        svg = read(path, String)
        @test occursin("<svg", svg)
        @test occursin("preserveAspectRatio=\"none\"", svg)
        @test occursin("stroke-dasharray", svg)
    end
end

@testset "NetCDF sampling and figure" begin
    mktempdir() do directory
        for member in 1:2
            folder = joinpath(directory, "member$member")
            mkpath(folder)
            NCDatasets.NCDataset(joinpath(folder, "output.nc"), "c") do ds
                NCDatasets.defDim(ds, "longitude", 2)
                NCDatasets.defDim(ds, "latitude", 2)
                NCDatasets.defDim(ds, "height", 1)
                NCDatasets.defDim(ds, "time", 2)
                NCDatasets.defVar(ds, "longitude", [4.0, 5.0], ("longitude",); attrib=Dict("units"=>"degrees_east"))
                NCDatasets.defVar(ds, "latitude", [50.0, 51.0], ("latitude",); attrib=Dict("units"=>"degrees_north"))
                NCDatasets.defVar(ds, "height", [100.0], ("height",); attrib=Dict("units"=>"m"))
                time = NCDatasets.defVar(ds, "time", Float64, ("time",); attrib=Dict("units"=>"hours since 2026-01-01 00:00:00"))
                time[:] = [0, 1]
                variable = NCDatasets.defVar(ds, "spec001_mr", Float64, ("longitude", "latitude", "height", "time"))
                variable[:, :, :, :] = zeros(2, 2, 1, 2)
                variable[1, 1, 1, :] = member == 1 ? [1.0, 4.0] : [3.0, 8.0]
            end
        end
        deterministic = EnsembleTimeSeries.collect_deterministic(joinpath(directory, "member1", "output.nc"),
            "spec001_mr", 50.1, 4.1, Dict("height"=>100.0))
        @test deterministic.concentration == [1.0, 4.0]
        @test deterministic.latitude == 50.0 && deterministic.longitude == 4.0
        @test deterministic.times == [DateTime(2026, 1, 1), DateTime(2026, 1, 1, 1)]
        @test !hasproperty(deterministic, :mean)
        @test !hasproperty(deterministic, :lower)
        deterministic_path = joinpath(directory, "deterministic.svg")
        EnsembleTimeSeries.render(deterministic_path, deterministic; layer="spec001_mr", dimensions=Dict("height"=>100.0), ensemble=false)
        @test occursin("<svg", read(deterministic_path, String))
        @test_throws ArgumentError EnsembleTimeSeries.collect_deterministic(joinpath(directory, "member1", "output.nc"),
            "spec001_mr", 60.0, 4.1, Dict("height"=>100.0))
        touch(joinpath(directory, "ensemble_mean.nc"))
        result = EnsembleTimeSeries.collect_series(directory, "spec001_mr", 50.1, 4.1, Dict("height"=>100.0))
        @test result.member_count == 2
        @test result.latitude == 50.0 && result.longitude == 4.0
        @test result.mean == [2.0, 6.0]
        @test result.median == [2.0, 6.0]
        @test result.lower ≈ [1.2, 4.4]
        @test result.upper ≈ [2.8, 7.6]
        @test result.times isa Vector{DateTime}
        @test result.times == [DateTime(2026, 1, 1), DateTime(2026, 1, 1, 1)]
        @test_throws ArgumentError EnsembleTimeSeries.collect_series(directory, "spec001_mr", 60.0, 4.1, Dict("height"=>100.0))
        path = joinpath(directory, "sampled-series.svg")
        EnsembleTimeSeries.render(path, result; layer="spec001_mr", dimensions=Dict("height"=>100.0))
        svg = read(path, String)
        @test occursin("<svg", svg)
        @test occursin("preserveAspectRatio=\"none\"", svg)
        @test occursin("stroke-dasharray", svg)
    end
end
