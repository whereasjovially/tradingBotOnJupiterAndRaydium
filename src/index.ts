import { Wallet } from '@project-serum/anchor';
import RaydiumSwap from './RaydiumSwap'
import { Transaction, VersionedTransaction, LAMPORTS_PER_SOL, Connection, PublicKey, Keypair  } from '@solana/web3.js'
import base58 from 'bs58'
import 'dotenv/config'
const connection = new Connection(
  process.env.RPC_URL
);
const wallet = new Wallet(Keypair.fromSecretKey(base58.decode(process.env.WALLET_PRIVATE_KEY))) 
const executeSwap = true // Change to true to execute swap
const useVersionedTransaction = true // Use versioned transaction

const prepareForRaydium = async ({baseMint, quoteMint}) => {
  console.log('Preparing...')
  const raydiumSwap = new RaydiumSwap(process.env.RPC_URL, process.env.WALLET_PRIVATE_KEY)
  // console.log(`Raydium swap initialized`)

  // Loading with pool keys from https://api.raydium.io/v2/sdk/liquidity/mainnet.json
  await raydiumSwap.loadPoolKeys()
  // console.log(`Loaded pool keys`)

  // Trying to find pool info in the json we loaded earlier and by comparing baseMint and tokenBAddress
  let poolInfo = raydiumSwap.findPoolInfoForTokens(baseMint, quoteMint)

  if (!poolInfo) poolInfo = await raydiumSwap.findRaydiumPoolInfo(baseMint, quoteMint)

  if (!poolInfo) {
    throw new Error("Couldn't find the pool info")
  }

  // console.log('Found pool info', poolInfo)
  console.log('Finished preparing.')
  return {
    raydiumSwap, poolInfo
  }
}
const buyInRaydium = async () => {
  const baseMint = process.env.BAST_MINT
  const quoteMint = process.env.QUOTE_MINT 
  const {raydiumSwap, poolInfo} = await prepareForRaydium({baseMint, quoteMint})

  const tokenAAmount = Number(process.env.BASE_MINT_AMOUNT)
    const tx = await raydiumSwap.getSwapTransaction(
    quoteMint,
    tokenAAmount,
    poolInfo,
    Number(process.env.PRIORITIZAION_FEE) * LAMPORTS_PER_SOL, // Prioritization fee, now set to (0.0005 SOL)
    useVersionedTransaction,
    'in',
    5 // Slippage
  )

  if (executeSwap) {
    const txid = useVersionedTransaction
      ? await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction)
      : await raydiumSwap.sendLegacyTransaction(tx as Transaction)

    console.log(`https://solscan.io/tx/${txid}`)
    console.log('wating to confirm transaction')
    try{
      const latestBlockHash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({blockhash:latestBlockHash.blockhash, lastValidBlockHeight: latestBlockHash.lastValidBlockHeight, signature:txid});
      console.log('confirmed')
      return txid
    }catch(err){
      console.log('retrying to buyInRaydium')
      return await buyInRaydium()
    }
    
  } else {
    const simRes = useVersionedTransaction
      ? await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction)
      : await raydiumSwap.simulateLegacyTransaction(tx as Transaction)

    console.log(simRes)
  }
}
const sellInRaydium = async (tokenAAmount) => {
  const quoteMint = process.env.BAST_MINT
  const baseMint = process.env.QUOTE_MINT 
  const {raydiumSwap, poolInfo} = await prepareForRaydium({baseMint, quoteMint})

  // const tokenAAmount = Number(process.env.BASE_MINT_AMOUNT)
    const tx = await raydiumSwap.getSwapTransaction(
    quoteMint,
    tokenAAmount,
    poolInfo,
    Number(process.env.PRIORITIZAION_FEE) * LAMPORTS_PER_SOL, // Prioritization fee, now set to (0.0005 SOL)
    useVersionedTransaction,
    'in',
    5 // Slippage
  )

  if (executeSwap) {
    const txid = useVersionedTransaction
      ? await raydiumSwap.sendVersionedTransaction(tx as VersionedTransaction)
      : await raydiumSwap.sendLegacyTransaction(tx as Transaction)

    console.log(`https://solscan.io/tx/${txid}`)
    console.log('wating to confirm transaction')
    try{
      const latestBlockHash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({blockhash:latestBlockHash.blockhash, lastValidBlockHeight: latestBlockHash.lastValidBlockHeight, signature:txid});
      console.log('confirmed')
      return txid
    }catch(err){
      console.log('retrying to sellInRaydium')
      return await sellInRaydium(tokenAAmount)
    }
    
  } else {
    const simRes = useVersionedTransaction
      ? await raydiumSwap.simulateVersionedTransaction(tx as VersionedTransaction)
      : await raydiumSwap.simulateLegacyTransaction(tx as Transaction)

    console.log(simRes)
  }
}

const buyInJupiter = async () => {
  const inputMint = process.env.BAST_MINT
  const outputMint = process.env.QUOTE_MINT
  const inputAmount = Number(process.env.BASE_MINT_AMOUNT)*10**Number(process.env.BASE_DECIMAL)
  const slippageBps = 50
  const quoteResponse = await (
    await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`
    )
  ).json();

  // get serialized transactions for the swap
  const data:any = await (    
    await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // quoteResponse from /quote api
        quoteResponse,
        // user public key to be used for the swap
        userPublicKey: wallet.publicKey.toString(),
        // auto wrap and unwrap SOL. default is true
        dynamicComputeUnitLimit: true,  // allow dynamic compute limit instead of max 1,400,000
        prioritizationFeeLamports: Number(process.env.PRIORITIZAION_FEE) * LAMPORTS_PER_SOL, // or custom lamports: 1000
        wrapAndUnwrapSol: true,
        // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
        // feeAccount: "fee_account_public_key"
      })
    })
  ).json();

  // deserialize the transaction
  const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  // const priorityFeeInstruction = await createDynamicPriorityFeeInstruction()
  // console.log('transaction message', transaction.message.compiledInstructions)
  // console.log('priorityFeeInstruction', priorityFeeInstruction)

  // sign the transaction
  transaction.sign([wallet.payer]);

  // Execute the transaction
  const rawTransaction = transaction.serialize()
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 5,
  });
  try{
    console.log('Waiting to confirm the transaction: ', `https://solscan.io/tx/${txid}`)
    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({blockhash:latestBlockHash.blockhash, lastValidBlockHeight: latestBlockHash.lastValidBlockHeight, signature:txid});
    console.log('Confirmed')
    return txid
  }catch(err){
    console.log('Retrying buy in jupiter')
    await buyInJupiter()
  }

}

const sellInJupiter = async (inputAmount) => {
  const  outputMint= process.env.BAST_MINT
  const  inputMint= process.env.QUOTE_MINT
  const slippageBps = 50
  // Make sure that you are using your own RPC endpoint.
  const connection = new Connection(
    process.env.RPC_URL
  );
  const wallet = new Wallet(
    Keypair.fromSecretKey(base58.decode(process.env.WALLET_PRIVATE_KEY || ""))
  );
  // console.log("Wallet:", wallet.publicKey.toBase58());
  const quoteResponse = await (
    await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=${slippageBps}`
    )
  ).json();

  // get serialized transactions for the swap
  const data:any = await (
    
    await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // quoteResponse from /quote api
        quoteResponse,
        // user public key to be used for the swap
        userPublicKey: wallet.publicKey.toString(),
        // auto wrap and unwrap SOL. default is true
        dynamicComputeUnitLimit: true,  // allow dynamic compute limit instead of max 1,400,000
        prioritizationFeeLamports: Number(process.env.PRIORITIZAION_FEE) * LAMPORTS_PER_SOL, // or custom lamports: 1000
        wrapAndUnwrapSol: true,
        // feeAccount is optional. Use if you want to charge a fee.  feeBps must have been passed in /quote API.
        // feeAccount: "fee_account_public_key"
      })
    })
  ).json();

  // deserialize the transaction
  const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
  var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  // const priorityFeeInstruction = await createDynamicPriorityFeeInstruction()
  // console.log('transaction message', transaction.message.compiledInstructions)
  // console.log('priorityFeeInstruction', priorityFeeInstruction)

  // sign the transaction
  transaction.sign([wallet.payer]);

  // Execute the transaction
  const rawTransaction = transaction.serialize()
  const txid = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    maxRetries: 5,
  });
  try{
    console.log('Waiting to confirm the transaction: ', `https://solscan.io/tx/${txid}`)
    const latestBlockHash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({blockhash:latestBlockHash.blockhash, lastValidBlockHeight: latestBlockHash.lastValidBlockHeight, signature:txid});
    console.log('Confirmed')
    return txid
  }catch(err){
    console.log('Retrying to sell in jupiter')
    await sellInJupiter (inputAmount)
  }
}

const fetchTokenBalance = async (tokenAddress:string) => {
  try {
    const mintAddress = new PublicKey(tokenAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: mintAddress });
    const tokenAccountInfo = tokenAccounts.value.find(accountInfo => accountInfo.account.data.parsed.info.mint === mintAddress.toString());
    if (tokenAccountInfo) {
      const tokenAccountAddress = tokenAccountInfo.pubkey;
      const balance = await connection.getTokenAccountBalance(tokenAccountAddress);
      return balance.value.uiAmount || 0;
    }
    return 0;
  } catch (error) {
    console.error(`Error fetching ${tokenAddress} balance:`, error);
    return 0;
  }
};

const tradeInRaydium = async () => {
  // buyInRaydium token 
  console.log('Started to buy')
  const successTxidtobuyInRaydium = await buyInRaydium()
  console.log("Bought successfully: ", successTxidtobuyInRaydium)

  // SellInRaydium token
  console.log('Started to sell')
  const boughtTokenAmount = await fetchTokenBalance(process.env.QUOTE_MINT)
  console.log('token amount to sellInRaydium', boughtTokenAmount)
  const successTxidtoSellInRaydium = await sellInRaydium(boughtTokenAmount)
  console.log("Sold successfully: ", successTxidtoSellInRaydium)
}

const tradeInJupiter = async () => {
  // buyInJupiter token 
  const successTxidtobuyInJupiter = await buyInJupiter()
  console.log("Bought successfully: ", successTxidtobuyInJupiter)

  // SellInJupiter token
  const boughtTokenAmount = await fetchTokenBalance(process.env.QUOTE_MINT)
  console.log('token amount to sell', boughtTokenAmount)
  const successTxidtoSell = await sellInJupiter(Math.floor(boughtTokenAmount*10**Number(process.env.QUOTE_DECIMAL)))
  console.log("Sold successfully: ", successTxidtoSell)
}

const start = async () => {
  let working = true
  setTimeout(()=>{
    working = false
  }, Number(process.env.DURATION) * 60 * 1000)

  while(working){
    await tradeInRaydium()
    await tradeInJupiter()
  }
  return
}

start()
