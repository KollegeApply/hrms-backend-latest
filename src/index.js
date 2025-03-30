if (process.env.NODE_ENV) {
    require ("dotenv").config({
        path:`.env.${process.env.NODE_ENV}`
    })
  } else require ("dotenv").config()
  
  const mongoose = require("mongoose")
  require("./expressServer")
  
  mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log(`🗄️ Mongodb running on ${process.env.MONGO_URI_PORT}`))
  .catch(err => console.log(err))