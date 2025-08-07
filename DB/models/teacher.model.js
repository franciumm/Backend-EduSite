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
      },
       role: {
        type: String,
        enum: ['main_teacher', 'assistant'],
        default: 'assistant'
      },
      permissions: {
        assignments: [{ type: Schema.Types.ObjectId, ref: 'group' }],
        sections:    [{ type: Schema.Types.ObjectId, ref: 'group' }],

        exams:       [{ type: Schema.Types.ObjectId, ref: 'group' }],
        materials:   [{ type: Schema.Types.ObjectId, ref: 'group' }]
      }
    },
    { timestamps: true }
  );
  
  export const teacherModel = model('teacher', teacherSchema);
  