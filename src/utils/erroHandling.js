


export const asyncHandler = (fn) => {
    return (req,res,next)=>{
        fn(req,res,next).catch(async (err) =>{
            
            return next(new Error ({Message : err.message  }, {cause : 500}))
        })
    }

}




export const globalerrorHandling = (error , req,res,next)=>{
    
    if (error){return res.status(error.cause || 500 ).json({Message : error.message  })
    }
}