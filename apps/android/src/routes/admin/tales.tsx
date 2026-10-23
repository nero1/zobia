import { useMemo } from 'react';
import { createFileRoute,useNavigate } from '@tanstack/react-router';
import { TalesModeration,type TalesTransport } from '@zobia/shared/ui/Tales';
import { apiClient } from '@/lib/api/client';
function Page(){const navigate=useNavigate();const api=useMemo<TalesTransport>(()=>({navigate:path=>void navigate({to:path as never}),request:async<T,>(path:string,method='GET',body?:unknown)=>(await apiClient.request<T>({url:path,method,data:body})).data}),[navigate]);return <TalesModeration api={api}/>;}
export const Route=createFileRoute('/admin/tales')({component:Page});
