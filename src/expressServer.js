const { app } = require("./server");

app.get('/',(req,res)=> res.status(200).send('HRMS Backend is running...'))

