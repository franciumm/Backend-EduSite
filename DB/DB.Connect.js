import mongoose from "mongoose";

const DBConnect =  ()=>{
    return  mongoose.connect( process.env.MONGOCONNECT, { // These options are for older Mongoose versions and should be kept.
      useNewUrlParser: true,
      useUnifiedTopology: true,
      
      // THIS IS THE MOST IMPORTANT OPTION:
      // It directly solves the original cold start timeout problem.
      serverSelectionTimeoutMS: 30000,  }).then(console.log('DB Connected'));
}


export default DBConnect;

