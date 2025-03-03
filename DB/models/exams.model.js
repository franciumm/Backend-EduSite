// /DB/models/exams.model.js

import { Schema, model } from "mongoose";

const examSchema = new Schema(
  {
    Name: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "teacher", required: true },
    groupIds: [{ type: Schema.Types.ObjectId, ref: "group" }], // Multiple groups
    grade: { type: Schema.Types.ObjectId, ref: "grade" },
    bucketName: String,
    key: String,
    path: String,
    startdate: { type: Date, required: true },
    enddate: { type: Date, required: true },
    enrolledStudents: [{ type: Schema.Types.ObjectId, ref: "student" }],
    rejectedStudents: [{ type: Schema.Types.ObjectId, ref: "student" }], // For exceptions you do NOT want
    /**
     * New: Custom timeline for certain students.
     * If a student is listed here, they must follow these dates instead of main start/end.
     */
    exceptionStudents: [
      {
        studentId: { type: Schema.Types.ObjectId, ref: "student" },
        startdate: Date,
        enddate: Date,
      },
    ],
  },
  { timestamps: true }
);

export const examModel = model("exam", examSchema);
