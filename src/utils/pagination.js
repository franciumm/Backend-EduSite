export const pagination = ({page= 1 , size =4})=>{
if(page <1){
    page = 1 
}
if(size < 0 ){
    size = 4
}
 const pageNum = parseInt(page, 10) || 1;
    const sizeNum = parseInt(size, 10) || 4;
 const finalPage = pageNum < 1 ? 1 : pageNum;
    const finalSize = sizeNum < 1 ? 4 : sizeNum;
    
    const limit = finalSize;
    const skip = (finalPage - 1) * finalSize;

return {limit , skip }
}