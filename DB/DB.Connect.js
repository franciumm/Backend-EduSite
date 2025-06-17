import mongoose from "mongoose";

const DBConnect =  async()=>{
    return  await mongoose.connect( process.env.MONGOCONNECT, { // These options are for older Mongoose versions and should be kept.
   
      serverSelectionTimeoutMS: 30000,  }).then(console.log('DB Connected'));
}


export default DBConnect;

