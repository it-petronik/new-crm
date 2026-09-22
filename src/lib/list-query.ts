export type ListQuery = { search:string; status:string; sort:string; from:string; to:string };
export const emptyQuery: ListQuery = { search:"",status:"all",sort:"default",from:"",to:"" };
export function listDate(item: object) { const r = item as Record<string,unknown>; return String(r.createdAt || r.at || r.due || "").slice(0,10); }
export function listStatus(item: object) { const r = item as Record<string,unknown>; return String(r.status || (typeof r.active === "boolean" ? r.active ? "Active":"Inactive" : "")); }
export function queryList<T extends object>(items:T[], query:ListQuery):T[] {
  const result = items.filter(item => {
    const date = listDate(item);
    return JSON.stringify(item).toLowerCase().includes(query.search.toLowerCase()) && (query.status === "all" || listStatus(item) === query.status) && (!query.from || date >= query.from) && (!query.to || (!!date && date <= query.to));
  });
  const name = (r:T) => {const v=r as Record<string,unknown>;return String(v.title || v.name || v.actor || "");};
  if(query.sort === "name") result.sort((a,b)=>name(a).localeCompare(name(b)));
  if(query.sort === "name-desc") result.sort((a,b)=>name(b).localeCompare(name(a)));
  if(query.sort === "newest") result.sort((a,b)=>listDate(b).localeCompare(listDate(a)));
  if(query.sort === "oldest") result.sort((a,b)=>listDate(a).localeCompare(listDate(b)));
  if(query.sort === "amount" || query.sort === "amount-desc") result.sort((a,b)=>(Number((a as Record<string,unknown>).amount || 0)-Number((b as Record<string,unknown>).amount || 0))*(query.sort === "amount" ? 1:-1));
  return result;
}
