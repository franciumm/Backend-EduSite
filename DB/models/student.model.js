import { Schema, model } from "mongoose";

const studentSchema = new Schema(
  {
    userName: {
      type: String,
      unique: [true, "Username must be unique"],
      required: [true, "UserName is required"],
      min: [2, "min length 2 characters"],
      max: [20, "max length 20 characters"],
      trim: true,
    },
    firstName: String,
    lastName: String,
    gradeId: {
      type: Schema.Types.ObjectId,
      ref: "grade",
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "group",
    },
    phone: { type: String },
    parentPhone: { type: String },
    email: {
      type: String,
      required: [true, "Email must be typed"],
      unique: [true, "Email must be unique"],
      lowercase: true,
      trim: true,
    },
    parentEmail: {
      type: String,
      required: [true, "Parent Email must be typed"],
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password must be typed"],
    },
    confirmEmail: {
      type: Boolean,
      default: false,
    },
    submittedassignments: {
      type: [Schema.Types.ObjectId],
      ref: "assignment",
    },
    submittedexams: {
      type: [Schema.Types.ObjectId],
      ref: "exam",
    },
  },
  { timestamps: true }
);

studentSchema.index({ email: 1 });
studentSchema.index({ phone: 1 });

const studentModel = model("student", studentSchema);
export default studentModel;
