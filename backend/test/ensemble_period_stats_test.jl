using Test, Dates
import NCDatasets
include(joinpath(@__DIR__, "../app/resources/flexpart/CC/flexpartoutputs/ensemble_period_stats.jl"))
using .EnsemblePeriodStats

@testset "Period exceedance counts members once" begin
    mktempdir() do dir
        for member in 1:3
            folder = joinpath(dir, "member$member"); mkpath(folder)
            NCDatasets.NCDataset(joinpath(folder, "output.nc"), "c") do ds
                for (name, size) in [("longitude",2), ("latitude",2), ("height",2), ("time",3)]
                    NCDatasets.defDim(ds,name,size)
                end
                NCDatasets.defVar(ds,"longitude",[4.,5.],("longitude",))
                NCDatasets.defVar(ds,"latitude",[50.,51.],("latitude",))
                NCDatasets.defVar(ds,"height",[100.,200.],("height",))
                t=NCDatasets.defVar(ds,"time",Float64,("time",);attrib=Dict("units"=>"hours since 2026-01-01"));t[:]=[0,1,2]
                values=Array{Union{Missing,Float64}}(zeros(2,2,2,3))
                values[1,1,1,:]=member==1 ? [5.,5.,5.] : member==2 ? [0.,0.,10.] : [0.,0.,0.]
                values[1,2,1,:].=missing
                values[2,2,1,:]=member==1 ? [missing,8.,missing] : member==2 ? [missing,0.,0.] : [0.,0.,0.]
                v=NCDatasets.defVar(ds,"spec001_mr",Float64,("longitude","latitude","height","time");fillvalue=-9999.);v[:,:,:,:]=values
                a=NCDatasets.defVar(ds,"alternate",Float64,("time","latitude","longitude","height");fillvalue=-9999.);a[:,:,:,:]=permutedims(values,(4,2,1,3))
            end
        end
        # This directory and file must never count as members.
        mkpath(joinpath(dir,"unrelated"));write(joinpath(dir,"ensemble_mean.nc"),"ignore")
        r=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3,Dict("height"=>1))
        @test r["memberCount"]==3
        @test r["analysis"] == "maximum"
        @test r["maximumValues"][2][1] == [[0.,1.],[5.,1.],[10.,1.]]
        @test r["maximumValues"][2][2] == [[0.,3.]]
        @test isempty(r["maximumValues"][1][1])
        @test r["maximumValues"][1][2] == [[0.,1.]] # incomplete members have unknown maxima

        @test r["counts"]==[[0,1],[2,0]]
        @test r["validCounts"]==[[0,2],[3,3]]
        @test isnothing(r["values"][1][1])
        @test r["values"][1][2]==50.
        @test r["values"][2][1]≈200/3
        @test r["values"][2][2]==0.
        @test r["xmin"]==3.5 && r["xmax"]==5.5
        @test r["ymin"]==49.5 && r["ymax"]==51.5
        @test r["startTime"]=="2026-01-01T00:00:00Z"
        @test r["endTime"]=="2026-01-01T02:00:00Z"
        short=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,2)
        @test short["maximumValues"][2][1] == [[0.,2.],[5.,1.]]
        @test short["counts"][2][1]==1
        @test short["values"][2][1]≈100/3
        single=EnsemblePeriodStats.calculate(dir,"spec001_mr",10.,3,3)
        @test single["counts"][2][1]==1 # inclusive endpoint, exact threshold
        high=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3,Dict("height"=>2))
        @test all(row->all(==(0.),row),high["values"])
        other=EnsemblePeriodStats.calculate(dir,"alternate",5.,1,3)
        @test isequal(other,r)
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",0.,1,3)
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",NaN,1,3)
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,3,2)
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,4)
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3,Dict("height"=>3))
        arrival=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3,Dict("height"=>1);arrival=true)
        @test arrival["analysis"] == "arrival"
        @test arrival["arrivalTimes"] == ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"]
        @test arrival["arrivalHistogram"][2][1] == [[0,1],[2,1]]
        @test arrival["arrivalHistogram"][1][2] == []
        @test arrival["arrivalHistogram"][2][2] == []
        @test all(sum((bin[2] for bin in arrival["arrivalHistogram"][y][x]);init=0) == arrival["arrivalCounts"][y][x] for y in 1:2 for x in 1:2)
        @test arrival["values"][2][1] == 1.
        @test arrival["arrivalLower"][2][1] ≈ .2
        @test arrival["arrivalUpper"][2][1] ≈ 1.8
        @test arrival["arrivalCounts"][2][1] == 2
        @test arrival["counts"][2][1] == 2
        @test isnothing(arrival["values"][2][2]) # complete data, no exceedance
        @test arrival["validCounts"][2][2] == 3
        @test isnothing(arrival["values"][1][1]) # no data
        @test arrival["validCounts"][1][1] == 0
        @test isnothing(arrival["values"][1][2]) # observed exceedance with unknown earlier arrival
        @test arrival["counts"][1][2] == 1
        @test arrival["arrivalCounts"][1][2] == 0
        later=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,2,3;arrival=true)
        @test later["values"][2][1] == .5
        @test later["arrivalHistogram"][2][1] == [[0,1],[1,1]]
        @test later["values"][1][2] == 0. # first selected output qualifies, no earlier selected missing output
        single_arrival=EnsemblePeriodStats.calculate(dir,"spec001_mr",10.,3,3;arrival=true)
        @test single_arrival["values"][2][1] == 0.
        reordered=EnsemblePeriodStats.calculate(dir,"alternate",5.,1,3;arrival=true)
        @test isequal(reordered,arrival)
        # Quantiles use actual elapsed time, rather than assuming equal output intervals.
        for member in 1:3
            NCDatasets.NCDataset(joinpath(dir,"member$member","output.nc"),"a") do ds
                ds["time"][:]=[0,2,6]
            end
        end
        uneven=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3;arrival=true)
        @test uneven["values"][2][1] == 3.
        @test uneven["arrivalHistogram"][2][1] == [[0,1],[2,1]]
        @test uneven["arrivalLower"][2][1] ≈ .6
        @test uneven["arrivalUpper"][2][1] ≈ 5.4
        # Snapshot distributions use concentrations at one saved time, never maxima over other times.
        snapshot=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,1; snapshot=true)
        @test snapshot["analysis"] == "timestep"
        @test !haskey(snapshot,"maximumValues")
        @test snapshot["concentrationValues"][2][1] == [[0.,2.],[5.,1.]]
        @test snapshot["concentrationValues"][1][1] == []
        @test snapshot["validCounts"][1][2] == 1
        @test snapshot["memberContours"] == [Dict("member"=>1,"cells"=>[2]),Dict("member"=>2,"cells"=>Int[]),Dict("member"=>3,"cells"=>Int[])]
        second=EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,2,2; snapshot=true)
        @test second["concentrationValues"][1][2] == [[0.,2.],[8.,1.]]
        @test second["validCounts"][1][2] == 3
        @test second["memberContours"][1]["cells"] == [1,2]
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3; snapshot=true)
        @test EnsemblePeriodStats.contour_indices(trues(3,3),1:3,3:-1:1) == [0,1,2,3,5,6,7,8]
        # Reject mismatched member times instead of silently combining different periods.
        NCDatasets.NCDataset(joinpath(dir,"member3","output.nc"),"a") do ds
            ds["time"][:]=[0,1,3]
        end
        @test_throws ArgumentError EnsemblePeriodStats.calculate(dir,"spec001_mr",5.,1,3)
    end
    mktempdir() do emptydir
        @test_throws ArgumentError EnsemblePeriodStats.calculate(emptydir,"spec001_mr",5.,1,2)
    end
end

@testset "Float32 grid coordinates" begin
    @test EnsemblePeriodStats.grid_spacing(Float64.(Float32[45.56,45.57,45.58,45.59])) ≈ 0.01 atol=1e-6
    @test EnsemblePeriodStats.grid_spacing(Float64.(Float32[45.59,45.58,45.57,45.56])) ≈ 0.01 atol=1e-6
    @test_throws ArgumentError EnsemblePeriodStats.grid_spacing([1.,2.,4.])
    @test_throws ArgumentError EnsemblePeriodStats.grid_spacing([1.,2.,1.])
end
