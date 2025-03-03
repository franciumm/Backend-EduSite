export const pagination = ({page= 1 , size =4})=>{
if(page <1){
    page = 1 
}
if(size < 0 ){
    size = 4
}

const limit = size ;
const skip = (page -1 ) * size ;

return {limit , skip }
}