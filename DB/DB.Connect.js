import mongoose from "mongoose";

const DBConnect =  ()=>{
    return  mongoose.connect( process.env.MONGOCONNECT, {
        serverSelectionTimeoutMS: 30000, 
      connectTimeoutMS: 30000,      
        socketOptions: {
        socketTimeoutMS: 45000,         
        keepAlive: true,                
        keepAliveInitialDelay: 300000
      }      
    }).then(console.log('DB Connected'));
}


export default DBConnect;

