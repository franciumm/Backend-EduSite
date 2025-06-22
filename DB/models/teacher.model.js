import {Schema, model} from "mongoose";
const teacherSchema = new Schema(
    {
      name: {
        type: String,
        required: [true, 'Teacher name is required'],
        trim: true,
      },
      email: {
        type: String,
        required: [true, 'Email must be typed'],
        unique: [true, 'Email must be unique'],
        lowercase: true,
        trim: true,
      },
      password: {
        type: String,
        required: [true, 'Password must be typed'],
      }
    },
    { timestamps: true }
  );
  
  export const teacherModel = model('teacher', teacherSchema);
  