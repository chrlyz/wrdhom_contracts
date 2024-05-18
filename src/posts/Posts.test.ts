import { PostsContract } from './PostsContract.js';
import { PostsSubcontractA } from './PostsSubcontractA.js';
import { PostsSubcontractB } from './PostsSubcontractB.js'; 
import { PostPublishingTransactionHashing } from './Posts';
import {
  Mina,
  PrivateKey,
  PublicKey,
  MerkleMap,
} from 'o1js';
import fs from 'fs/promises';

let proofsEnabled = true;

export type Config = {
  deployAliases: Record<
    string,
    {
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};

describe(`the PostsContract and the Posts ZkProgram`, () => {
  let user1Address: PublicKey,
    user1Key: PrivateKey,
    user2Address: PublicKey,
    user2Key: PrivateKey,
    postsContractAddress: PublicKey,
    postsContractKey: PrivateKey,
    postsContract: PostsContract,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    Local: any

  beforeAll(async () => {
    if (proofsEnabled) {
      console.log('Compiling PostPublishingTransactionHashing ZkProgram...');
      const zkProgramAnalysis = await PostPublishingTransactionHashing.analyzeMethods();
      console.log(zkProgramAnalysis)
      console.log('Compiling PostsContract...');
      const contractAnalysis = await PostsContract.analyzeMethods()
      console.log(contractAnalysis);
      console.log('Compiling PostsSubcontractA...');
      const PostsSubcontractAAnalysis = await PostsSubcontractA.analyzeMethods()
      console.log(PostsSubcontractAAnalysis);
      console.log('Compiling PostsSubcontractB...');
      const PostsSubcontractBAnalysis = await PostsSubcontractB.analyzeMethods()
      console.log(PostsSubcontractBAnalysis);
      console.log('Compiled');
    }
  });

  beforeEach(async () => {
    Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    user1Key = Local.testAccounts[0].key;
    user1Address = Local.testAccounts[0].key.toPublicKey();
    user2Key = Local.testAccounts[1].key;
    user2Address = Local.testAccounts[1].key.toPublicKey();
    usersPostsCountersMap = new MerkleMap();
    postsMap = new MerkleMap();
    const postsConfigJson: Config = JSON.parse(
      await fs.readFile('config.json', 'utf8')
    );
    const postsConfig = postsConfigJson.deployAliases['postsContract'];
    const postsContractKeysBase58: { privateKey: string; publicKey: string } =
      JSON.parse(await fs.readFile(postsConfig.keyPath, 'utf8'));
    postsContractKey = PrivateKey.fromBase58(
      postsContractKeysBase58.privateKey
    );
    postsContractAddress = postsContractKey.toPublicKey();
    postsContract = new PostsContract(postsContractAddress);
  });

  test(`PostsContract and Posts ZkProgram functionality`, async () => {
    
  });
});
