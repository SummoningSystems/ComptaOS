import { useState } from "react";
import { api, selectWorkspace } from "../../api/client";
import type { AuthUser } from "../../api/auth";
import type { Company } from "../../types";
import { Field, errorMessage } from "./shared";
import "./household.css";
export function HouseholdSetup({user,onCancel}:{user:AuthUser|null;onCancel:()=>void}) {
  const [name,setName]=useState("Notre foyer");
  const [first,setFirst]=useState(user?.displayName??"");
  const [second,setSecond]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  return <main className="hh hh-setup"><form onSubmit={async event=>{
    event.preventDefault();setBusy(true);setError("");
    try {const {data}=await api.post<Company>("/workspaces",{name,kind:"household",people:[first,second]});selectWorkspace(data.id);const url=new URL(location.href);url.searchParams.delete("newHousehold");location.assign(url);}
    catch(error){setError(errorMessage(error));setBusy(false);}
  }}><p className="hh-eyebrow">COMPTAOS · FINANCES PARTAGÉES</p><h1>Un espace pour votre foyer</h1><p>Deux personnes, des comptes personnels et professionnels, une vue commune. Vous pourrez modifier les six comptes proposés après la création.</p>
  <Field label="Nom du foyer"><input required value={name} onChange={e=>setName(e.target.value)}/></Field>
  <Field label="Première personne"><input required value={first} onChange={e=>setFirst(e.target.value)}/></Field>
  <Field label="Deuxième personne"><input required value={second} onChange={e=>setSecond(e.target.value)}/></Field>
  <p>Ces noms servent à organiser les dépenses. Invitez ensuite votre partenaire dans « Membres » pour créer son accès.</p>
  {error&&<p role="alert" className="hh-error">{error}</p>}
  <footer><button type="button" onClick={onCancel}>Annuler</button><button className="hh-primary" disabled={busy}>Créer le foyer</button></footer></form></main>;
}
