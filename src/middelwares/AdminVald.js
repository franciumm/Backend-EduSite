
const isValid = (schema) => {
    return (req,res,next) => {
        const requestCopy = {...req.body , ...req.params , ...req.query};
        const validationResult = schema.validate(requestCopy,{abortEarly : false});
        if(validationResult.error){
            const messages = validationResult.error.details.map(err => err.message);
            return next(new Error(`${messages}`), {cause : 400});
        }
        return next();
    }
}

export default isValid;