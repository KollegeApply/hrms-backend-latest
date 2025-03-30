const express = require("express")
const app = express()
const cors = require('cors');
const multer = require('multer')

app.use(express.urlencoded({extended:true}))
app.use(express.json());
app.use(cors())
app.use(multer().any())

app.listen(process.env.NODE_PORT || 3301 ,err => {
    if (err) {
        return console.error(err);
    }
    return console.log(`🚀 Server is listening on Port : ${process.env.NODE_PORT || 3301}`);
})

module.exports = {app}