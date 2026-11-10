using Genie.Router, Genie.Requests, Genie.Assets
using SearchLight
using CbrnAlertApp.AuthenticationController
using CbrnAlertApp.Atp45Controller
using CbrnAlertApp.FlexpartController
using CbrnAlertApp.FlexpartInputsController
using CbrnAlertApp.FlexpartRunsController
using CbrnAlertApp.FlexpartOutputsController
using JSONWebTokens
using StructTypes
using UUIDs
using YAML

using SwagUI

using SearchLight
using CbrnAlertApp.Users

using CbrnAlertApp: API_DOC_FILE

using CbrnAlertApp: EXTRACTED_WEATHER_DATA_DIR, FLEXPART_RUNS_DIR, TMP_DIR_PATH

mkpath(EXTRACTED_WEATHER_DATA_DIR)
mkpath(FLEXPART_RUNS_DIR)
mkpath(TMP_DIR_PATH)

global DEBUG_PAYLOAD = 0
global DEBUG_PARAMS = 0
global DEBUG_REQUEST = 0

route("/api/login", AuthenticationController.login, method = POST)

api_routes = [
    ("/forecast/available", Atp45Controller.available_steps, (method = GET,)),
    ("/atp45/tree", Atp45Controller.get_tree, (method = GET,)),
    ("/atp45/run", Atp45Controller.post_run, (method = POST,)),
    ("/flexpart/input", FlexpartInputsController.data_retrieval, (method = POST,)),
    ("/flexpart/inputs", FlexpartInputsController.get_inputs, (method = GET,)),
    ("/flexpart/inputs/:inputId::String", FlexpartInputsController.delete_input, (method = DELETE,)),
    ("/flexpart/inputs/:inputId::String", FlexpartInputsController.rename_input, (method = PUT,)),
    ("/flexpart/run", FlexpartRunsController.run, (method = POST,)),
    ("/flexpart/runs", FlexpartRunsController.get_runs, (method = GET,)),
    ("/flexpart/runs/:runId::String", FlexpartRunsController.get_run, (method = GET,)),
    ("/flexpart/runs/:runId::String", FlexpartRunsController.delete_run, (method = DELETE,)),
    ("/flexpart/runs/:runId::String", FlexpartRunsController.rename_run, (method = PUT,)),
    ("/flexpart/runs/:runId::String/outputs", FlexpartOutputsController.get_outputs, (method = GET,)),
    ("/flexpart/outputs/:outputId::String", FlexpartOutputsController.get_output, (method = GET,)),
    ("/flexpart/outputs/:outputId::String/layers/", FlexpartOutputsController.get_layers, (method = GET,)),
    ("/flexpart/outputs/:outputId::String/dimensions/", FlexpartOutputsController.get_dimensions, (method = GET,)),
    ("/flexpart/outputs/:outputId::String/slice/", FlexpartOutputsController.get_slice, (method = POST,)),
    ("/flexpart/outputs/:outputId::String/timeseries/", FlexpartOutputsController.get_ensemble_timeseries, (method = POST,)),
    ("/flexpart/outputs/:outputId::String/stats/", FlexpartOutputsController.get_ensemble_stats, (method = POST,))
]

for (url, f, keyargs) in api_routes
    route("/api" * url; keyargs...) do
        if ENV["GENIE_ENV"] !== "prod"
            global DEBUG_PAYLOAD = Genie.Requests.jsonpayload()
            global DEBUG_PARAMS = Genie.Router.params()
            global DEBUG_REQUEST = Genie.Router.request()
        end
        Users.@authenticated!
        f()
    end
end

route("/docs") do 
    swagger_document = YAML.load_file(API_DOC_FILE; dicttype=Dict{String, Any})
    render_swagger(swagger_document)
end