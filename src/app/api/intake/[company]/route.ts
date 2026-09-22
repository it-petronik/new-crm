import {NextResponse} from 'next/server';
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {db,isPreview} from '@/lib/db';
import {type RecordItem,companies} from '@/lib/domain';
const payload=z.object({eventId:z.string().min(8).max(100),title:z.string().min(2).max(160),contact:z.string().max(160),email:z.email(),phone:z.string().max(50).optional(),product:z.string().max(160),quantity:z.number().min(0).max(100000000),destination:z.string().max(160),message:z.string().max(5000).optional(),website:z.string().max(100)});
// Server-to-server integration. Secrets must never be exposed in a website's browser code.
export async function POST(request:Request,{params}:{params:Promise<{company:string}>}){
 try{
 const slug=(await params).company.toLowerCase();const company=companies.find(c=>c.toLowerCase()===slug);
 if(!company||isPreview()||!process.env.DATABASE_URL)return NextResponse.json({error:'Intake is not configured.'},{status:503});
 const prefix=`INTAKE_${slug.toUpperCase()}`;const secret=process.env[`${prefix}_SECRET`];const ownerId=process.env[`${prefix}_OWNER_ID`];
 if(!secret||secret.length<32||!ownerId)return NextResponse.json({error:'Intake is not configured.'},{status:503});
 const timestamp=request.headers.get('x-enercore-timestamp')||'';const signature=request.headers.get('x-enercore-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000||!/^\w{64}$/.test(signature))return NextResponse.json({error:'Invalid signature.'},{status:401});
 const buffer=await request.arrayBuffer();if(buffer.byteLength>20000)return NextResponse.json({error:'Payload too large.'},{status:413});
 const raw=Buffer.from(buffer).toString('utf8');const expected=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex');
 if(!/^[a-f0-9]{64}$/i.test(signature)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex')))return NextResponse.json({error:'Invalid signature.'},{status:401});
 const input=payload.parse(JSON.parse(raw));const owner=await db.user.findUnique({where:{id:ownerId}});
 if(!owner?.active||!(owner.companies as string[]).includes(company)||!['MD','Group Manager','Branch Manager','Sales Manager','Sales Executive'].includes(owner.role))return NextResponse.json({error:'Lead routing needs configuration.'},{status:503});
 const id='WEB-'+createHash('sha256').update(`${company}:${input.eventId}`).digest('hex').slice(0,40);const now=new Date().toISOString();
 const record:RecordItem={id,kind:'leads',company,branch:(owner.branches as string[])[0]||'Main',title:input.title,contact:input.contact,email:input.email,phone:input.phone||'',product:input.product,quantity:input.quantity,unit:'MT',amount:0,currency:'USD',status:'New',ownerId:owner.id,owner:owner.name,due:new Date(Date.now()+86400000).toISOString().slice(0,10),destination:input.destination,detail:input.message||'',source:`Website: ${input.website}`,createdAt:now,updatedAt:now};
 const duplicate=await db.$transaction(async tx=>{if(await tx.businessRecord.findUnique({where:{id}}))return true;await tx.businessRecord.create({data:{id,kind:'leads',company,branch:record.branch,ownerId:owner.id,status:'New',payload:record as unknown as Prisma.InputJsonValue}});await tx.auditEvent.create({data:{id:crypto.randomUUID(),company,actor:'Website intake',actorId:owner.id,recordId:id,action:'Created website enquiry'}});return false;});
 return NextResponse.json({id,duplicate},{status:duplicate?200:201});
 }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return NextResponse.json({duplicate:true},{status:200});return NextResponse.json({error:'Unable to accept enquiry. Validate the payload.'},{status:400});}
}
