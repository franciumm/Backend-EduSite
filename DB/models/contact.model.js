import { Schema, model } from "mongoose";

const contactSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true,
      unique : true
    },
    phone: {
      type: String,
      trim: true,
            unique : true

    },
    subject: {
      type: String,
      required: [true, 'Subject is required.'],
      trim: true
    },
    message: {
      type: String,
      required: [true, 'Message is required.'],
      trim: true
    },
    // This will link to a student account if the user is logged in
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'student',
      default: null
    },
    // This allows teachers to manage the workflow
    status: {
      type: String,
      enum: ['pending', 'resolved'],
      default: 'pending',
      index: true
    }
  },
  { timestamps: true }
);

export const contactModel = model('contact', contactSchema);