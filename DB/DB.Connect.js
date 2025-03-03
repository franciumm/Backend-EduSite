import mongoose from "mongoose";

const DBConnect =  ()=>{
    return  mongoose.connect( process.env.MONGOCONNECT, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 30000, 
    }).then(console.log('DB Connected'));
}


export default DBConnect;

