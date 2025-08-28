import { Schema, model } from "mongoose";

const contentStreamSchema = new Schema({
    userId: { 
        type: Schema.Types.ObjectId, 
        required: true, 
        index: true 
    },
    contentId: { 
        type: Schema.Types.ObjectId, 
        required: true, 
        refPath: 'contentType' 
    },
    contentType: {
        type: String,
        required: true,
        enum: ['assignment', 'exam', 'material', 'section']
    },
 
    groupId: { 
        type: Schema.Types.ObjectId, 
        ref: 'group',
        index: true
    },
    isVisible: { 
        type: Boolean, 
        default: true 
    },
}, { timestamps: true });

contentStreamSchema.index({ userId: 1, createdAt: -1 });

export const contentStreamModel = model('contentStream', contentStreamSchema);