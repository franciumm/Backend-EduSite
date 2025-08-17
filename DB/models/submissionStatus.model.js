import { Schema, model } from "mongoose";

const submissionStatusSchema = new Schema({
    studentId: { 
        type: Schema.Types.ObjectId, 
        ref: 'student', 
        required: true 
    },
    // This can be an assignmentId or an examId
    contentId: {
        type: Schema.Types.ObjectId,
        required: true,
        refPath: 'contentType'
    },
    contentType: {
        type: String,
        required: true,
        enum: ['assignment', 'exam']
    },
    groupId: {
        type: Schema.Types.ObjectId,
        ref: 'group',
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['assigned', 'submitted', 'marked'],
        default: 'assigned'
    },
    submissionId: {
        type: Schema.Types.ObjectId,
        refPath: 'submissionModel'
    },
    submissionModel: {
        type: String,
        required: true,
        enum: ['subassignment', 'subexam']
    },
    score: {
        type: Number,
        default: null
    },
    isLate: {
        type: Boolean,
        default: false,
    },
    SubmitDate: Date,
}, { timestamps: true });

submissionStatusSchema.index({ contentId: 1, groupId: 1 });
submissionStatusSchema.index({ studentId: 1, contentId: 1 }, { unique: true });

export const submissionStatusModel = model('submissionStatus', submissionStatusSchema);