import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {companies} from '../src/lib/domain';
async function main(){
 if(process.env.BOOTSTRAP_CONFIRM!=='CREATE_INITIAL_ADMIN')throw new Error('Explicit bootstrap confirmation is required.');
 const email=process.env.BOOTSTRAP_EMAIL;const password=process.env.BOOTSTRAP_PASSWORD;
 if(!email||!password||password.length<14)throw new Error('Provide an email and a password of at least 14 characters through environment variables.');
 const db=new PrismaClient();try{if(await db.user.count())throw new Error('Users already exist. Initial bootstrap is disabled.');await db.user.create({data:{email:email.toLowerCase(),name:'Enercore Administrator',passwordHash:await bcrypt.hash(password,12),role:'MD',companies:[...companies],branches:[]}});console.log('Initial administrator created. No demonstration records were added.');}finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
