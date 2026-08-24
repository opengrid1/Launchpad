import{f as $,u as _,A,E as p}from"./lit-element-B3y9oplH.js";/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const v={attribute:!0,type:String,converter:_,reflect:!1,hasChanged:$},b=(t=v,e,s)=>{const{kind:n,metadata:i}=s;let r=globalThis.litPropertyMetadata.get(i);if(r===void 0&&globalThis.litPropertyMetadata.set(i,r=new Map),n==="setter"&&((t=Object.create(t)).wrapped=!0),r.set(s.name,t),n==="accessor"){const{name:o}=s;return{set(a){const l=e.get.call(this);e.set.call(this,a),this.requestUpdate(o,l,t,!0,a)},init(a){return a!==void 0&&this.C(o,void 0,t,a),a}}}if(n==="setter"){const{name:o}=s;return function(a){const l=this[o];e.call(this,a),this.requestUpdate(o,l,t,!0,a)}}throw Error("Unsupported decorator location: "+n)};function y(t){return(e,s)=>typeof s=="object"?b(t,e,s):((n,i,r)=>{const o=i.hasOwnProperty(r);return i.constructor.createProperty(r,n),o?Object.getOwnPropertyDescriptor(i,r):void 0})(t,e,s)}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */function U(t){return y({...t,state:!0,attribute:!1})}/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const j=t=>t??A;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const d={ATTRIBUTE:1,CHILD:2},g=t=>(...e)=>({_$litDirective$:t,values:e});class u{constructor(e){}get _$AU(){return this._$AM._$AU}_$AT(e,s,n){this._$Ct=e,this._$AM=s,this._$Ci=n}_$AS(e,s){return this.update(e,s)}update(e,s){return this.render(...s)}}/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const N=g(class extends u{constructor(t){var e;if(super(t),t.type!==d.ATTRIBUTE||t.name!=="class"||((e=t.strings)==null?void 0:e.length)>2)throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.")}render(t){return" "+Object.keys(t).filter(e=>t[e]).join(" ")+" "}update(t,[e]){var n,i;if(this.st===void 0){this.st=new Set,t.strings!==void 0&&(this.nt=new Set(t.strings.join(" ").split(/\s/).filter(r=>r!=="")));for(const r in e)e[r]&&!((n=this.nt)!=null&&n.has(r))&&this.st.add(r);return this.render(e)}const s=t.element.classList;for(const r of this.st)r in e||(s.remove(r),this.st.delete(r));for(const r in e){const o=!!e[r];o===this.st.has(r)||(i=this.nt)!=null&&i.has(r)||(o?(s.add(r),this.st.add(r)):(s.remove(r),this.st.delete(r)))}return p}});/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const O=t=>t===null||typeof t!="object"&&typeof t!="function",C=t=>t.strings===void 0;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const c=(t,e)=>{var n;const s=t._$AN;if(s===void 0)return!1;for(const i of s)(n=i._$AO)==null||n.call(i,e,!1),c(i,e);return!0},h=t=>{let e,s;do{if((e=t._$AM)===void 0)break;s=e._$AN,s.delete(t),t=e}while((s==null?void 0:s.size)===0)},f=t=>{for(let e;e=t._$AM;t=e){let s=e._$AN;if(s===void 0)e._$AN=s=new Set;else if(s.has(t))break;s.add(t),w(e)}};function m(t){this._$AN!==void 0?(h(this),this._$AM=t,f(this)):this._$AM=t}function T(t,e=!1,s=0){const n=this._$AH,i=this._$AN;if(i!==void 0&&i.size!==0)if(e)if(Array.isArray(n))for(let r=s;r<n.length;r++)c(n[r],!1),h(n[r]);else n!=null&&(c(n,!1),h(n));else c(this,t)}const w=t=>{t.type==d.CHILD&&(t._$AP??(t._$AP=T),t._$AQ??(t._$AQ=m))};class I extends u{constructor(){super(...arguments),this._$AN=void 0}_$AT(e,s,n){super._$AT(e,s,n),f(this),this.isConnected=e._$AU}_$AO(e,s=!0){var n,i;e!==this.isConnected&&(this.isConnected=e,e?(n=this.reconnected)==null||n.call(this):(i=this.disconnected)==null||i.call(this)),s&&(c(this,e),h(this))}setValue(e){if(C(this._$Ct))this._$Ct._$AI(e,this);else{const s=[...this._$Ct._$AH];s[this._$Ci]=e,this._$Ct._$AI(s,this,0)}}disconnected(){}reconnected(){}}export{O as a,N as b,g as e,I as f,y as n,j as o,U as r};
