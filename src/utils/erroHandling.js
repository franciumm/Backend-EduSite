

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise
      .resolve(fn(req, res, next))
      .catch(next);
  };
};


export const globalerrorHandling = (error , req,res,next)=>{
    
    if (error){return res.status(error.cause || 500 ).json({Message : error.message  })
    }
}