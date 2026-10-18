// One budget spans every coordinator and feed context in the application.
export class PlayerBudgetError extends Error {
  constructor() { super('Native player budget reached'); this.name = 'PlayerBudgetError'; }
}

export class PlayerBudget {
  private live=0;
  constructor(private readonly limit=3) {}
  get count(){return this.live;}
  acquire<T>(create:()=>T,dispose:(value:T)=>void) {
    if(this.live>=this.limit)throw new PlayerBudgetError();
    this.live++;
    let value:T;
    try{value=create();}catch(e){this.live--;throw e;}
    let released=false;
    return {value,release:()=>{if(released)return;released=true;try{dispose(value);}finally{this.live--;}}};
  }
}
