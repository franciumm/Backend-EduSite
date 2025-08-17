import {Schema, model} from "mongoose";
const courseSchema = new Schema(
    {
    courseName: { type: String, required: true },

    name: { type: String, required: true },

     grade: {
        type: Number,
        required: true,
      },

    phone :   {
        type: String,
        required: true,
      },

    email: { type: String, required: true , unique : true},

    description: { type: String},
    },
    { timestamps: true }
  );
  
  export const courseModel = model('course', courseSchema);