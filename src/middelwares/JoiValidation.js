  const Joivalidation = (schema)=>{
    return (req,res,next)=>{
        const validateData = schema.validate(req.body , {abortEarly : false});
        if(validateData.error){
          return res.json({Message : validateData.error.details.path})}else {return next()
          }
    }
    
    }

    export default Joivalidation