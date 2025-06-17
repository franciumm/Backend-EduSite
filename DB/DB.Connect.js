import mongoose from "mongoose";

const DBConnect =  ()=>{
    return  mongoose.connect( process.env.MONGOCONNECT, {
      useNewUrlParser: true, // Recommended for older versions
      useUnifiedTopology: true, // Recommended for older versions
      
      // All your timeout and keepAlive options belong here, at the top level.
      serverSelectionTimeoutMS: 30000, 
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,         
      keepAlive: true,                
      // This is the correct spelling for the Mongoose v5 driver.
      keepAliveInitialDelay: 300000     
    }).then(console.log('DB Connected'));
}


export default DBConnect;

