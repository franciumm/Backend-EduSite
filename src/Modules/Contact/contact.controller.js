import { contactModel } from "../../../DB/models/contact.model.js";
import { asyncHandler } from "../../utils/erroHandling.js";
import { pagination } from "../../utils/pagination.js";

/**
 * @desc    Create a new contact message
 * @route   POST /api/v1/contact
 * @access  Public
 */
export const createContactMessage = asyncHandler(async (req, res, next) => {
    const { name, email, phone, subject, message } = req.body;

    const payload = { name, email, phone, subject, message };

    // If the user is a logged-in student, link their ID to the message
    if (req.user && !req.isteacher) {
        payload.createdBy = req.user._id;
    }

    const contactMessage = await contactModel.create(payload);
    res.status(201).json({ message: "Your message has been received. We will get back to you shortly.", data: contactMessage });
});

/**
 * @desc    Get all contact messages
 * @route   GET /api/v1/contact
 * @access  Private (Teachers/Assistants)
 */
export const getAllContactMessages = asyncHandler(async (req, res, next) => {
    if (!req.isteacher) {
        return next(new Error("You are not authorized to view this information.", { cause: 403 }));
    }

    const { page, size, status } = req.query;
    const { limit, skip } = pagination({ page, size });

    const filter = {};
    if (status) {
        filter.status = status;
    }

    const [messages, total] = await Promise.all([
        contactModel.find(filter)
            .populate('createdBy', 'userName firstName lastName email') // Show student info if available
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        contactModel.countDocuments(filter)
    ]);

    res.status(200).json({
        message: "Contact messages fetched successfully.",
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page) || 1,
        data: messages
    });
});

/**
 * @desc    Update a message's status
 * @route   PATCH /api/v1/contact/:contactId/status
 * @access  Private (Teachers/Assistants)
 */
export const updateStatus = asyncHandler(async (req, res, next) => {
    if (!req.isteacher) {
        return next(new Error("You are not authorized to perform this action.", { cause: 403 }));
    }

    const { contactId } = req.params;
    const { status } = req.body;

    const updatedMessage = await contactModel.findByIdAndUpdate(
        contactId,
        { status },
        { new: true, runValidators: true }
    );

    if (!updatedMessage) {
        return next(new Error("Message not found.", { cause: 404 }));
    }

    res.status(200).json({ message: `Message status updated to '${status}'.`, data: updatedMessage });
});

/**
 * @desc    Delete a contact message
 * @route   DELETE /api/v1/contact/:contactId
 * @access  Private (Teachers/Assistants)
 */
export const deleteMessage = asyncHandler(async (req, res, next) => {
    if (!req.isteacher) {
        return next(new Error("You are not authorized to perform this action.", { cause: 403 }));
    }
    
    const { contactId } = req.params;
    const deletedMessage = await contactModel.findByIdAndDelete(contactId);

    if (!deletedMessage) {
        return next(new Error("Message not found.", { cause: 404 }));
    }

    res.status(200).json({ message: "Message deleted successfully." });
});