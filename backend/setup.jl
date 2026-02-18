if isfile(joinpath("db", "db.sqlite"))
    println("db exists, skipping initialization")
    exit()
end
  
using Genie
Genie.loadapp()
  
using SearchLight
using SearchLightSQLite
SearchLight.Migration.init()
SearchLight.Migration.status()
SearchLight.Migration.allup()
  
using CbrnAlertApp
using CbrnAlertApp.Users
Users.add("test", "test", username = "test")