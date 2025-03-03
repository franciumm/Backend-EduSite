import { pagination } from "./pagination.js"

export class Apifeatures {
    constructor(mongooseQuery,queryDate){
        this.mongooseQuery = mongooseQuery
        this.queryDate = queryDate
    }

pagination  (){
    const {page , size }= this.queryDate
    const {limit , skip } = pagination({page , size });

    this.mongooseQuery.limit(limit).skip(skip)
    return this
}


sort(){
    this.mongooseQuery.sort(this.queryDate.sort?.replaceAll(',',''))
return this 

}

select (){
    this.mongooseQuery.select(this.queryDate.select?.replaceAll(',',''))
    return this 

}

filter (){
    const queryInstance = {...this.queryDate}
    const execuldeKeysArr = ['page', 'size','sort','select','search']
    execuldeKeysArr.forEach((key)=>delete queryInstance[key])
    const queryString = JSON.parse(JSON.stringify(queryInstance).replace(/gt|gte|lt|lte|in|nin|eq|neq|regex/g,(match)=>`$${match}`))
    this.mongooseQuery.find(queryString);
    return this 
}

}