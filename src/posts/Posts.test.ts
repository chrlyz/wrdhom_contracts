import { PostsContract } from './PostsContract';
import { PostsContractB } from './PostsContractB';
import { PostsTransition, PostState, PostsBlockHashing } from './Posts';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  CircuitString,
  Poseidon,
  MerkleMap,
  UInt32,
} from 'o1js';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
  createPostDeletionTransitionValidInputs,
  createPostRestorationTransitionValidInputs,
} from './PostsUtils';

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
      console.log('Compiling Posts ZkProgram...');
      const zkProgramAnalysis = await PostsBlockHashing.analyzeMethods();
      console.log(zkProgramAnalysis)
      //await Posts.compile();
      console.log('Compiling PostsContract...');
      const contractAnalysis = await PostsContract.analyzeMethods()
      console.log(contractAnalysis)
      const contractBAnalysis = await PostsContractB.analyzeMethods()
      console.log(contractBAnalysis)
      //await PostsContract.compile();
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
    const postsConfig = postsConfigJson.deployAliases['posts'];
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
