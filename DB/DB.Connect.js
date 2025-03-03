import mongoose from "mongoose";

const DBConnect =  ()=>{
    return  mongoose.connect( process.env.MONGOCONNECT).then(console.log('DB Connected'));
}


export default DBConnect;

