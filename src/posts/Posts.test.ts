import { PostsContract } from './PostsContract';
import { PostsTransition, PostState, Posts } from './Posts';
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
import { Config } from './PostsDeploy';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
  createPostDeletionTransitionValidInputs,
  createPostRestorationTransitionValidInputs,
} from './PostsUtils';
import * as dotenv from 'dotenv';

dotenv.config();
const PROOFS_ENABLED = process.env.PROOFS_ENABLED === 'true' || false;

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
    if (PROOFS_ENABLED) {
      console.log('Compiling Posts ZkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiled');
    }
  });

  beforeEach(async () => {
    Local = await Mina.LocalBlockchain({ proofsEnabled: PROOFS_ENABLED });
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
    // ==============================================================================
    // 1. Deploys PostsContract.
    // ==============================================================================

    await deployPostsContract(
      user1Address,
      user1Key,
      postsContract,
      postsContractKey
    );

    // Validate expected state
    const allPostsCounterState = postsContract.allPostsCounter.get();
    const usersPostsCountersState = postsContract.usersPostsCounters.get();
    const postsState = postsContract.posts.get();
    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);

    console.log('PostsContract deployed');

    // ==============================================================================
    // 2. Publishes on-chain proof for publication of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid1 = createPostPublishingTransitionValidInputs(
      user1Address,
      user1Key,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1),
      Field(0),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition1 = PostsTransition.createPostPublishingTransition(
      valid1.signature,
      valid1.postState.allPostsCounter.sub(1),
      valid1.initialUsersPostsCounters,
      valid1.latestUsersPostsCounters,
      valid1.postState.userPostsCounter.sub(1),
      valid1.userPostsCounterWitness,
      valid1.initialPosts,
      valid1.latestPosts,
      valid1.postState,
      valid1.postWitness
    );

    // Create valid proof for our state transition
    let proof1: any;
    if (PROOFS_ENABLED) {
      proof1 = await Posts.provePostPublishingTransition(
        transition1,
        valid1.signature,
        valid1.postState.allPostsCounter.sub(1),
        valid1.initialUsersPostsCounters,
        valid1.latestUsersPostsCounters,
        valid1.postState.userPostsCounter.sub(1),
        valid1.userPostsCounterWitness,
        valid1.initialPosts,
        valid1.latestPosts,
        valid1.postState,
        valid1.postWitness
      );
    } else {
        proof1 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition1.blockHeight,
            initialAllPostsCounter: transition1.initialAllPostsCounter,
            latestAllPostsCounter: transition1.latestAllPostsCounter,
            initialUsersPostsCounters: transition1.initialUsersPostsCounters,
            latestUsersPostsCounters: transition1.latestUsersPostsCounters,
            initialPosts: transition1.initialPosts,
            latestPosts: transition1.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn1 = await Mina.transaction(user1Address, async () => {
      postsContract.update(proof1);
    });
    await txn1.prove();
    await txn1.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(1));

    // Validate expected state
    const allPostsCounterState1 = postsContract.allPostsCounter.get();
    const usersPostsCountersState1 = postsContract.usersPostsCounters.get();
    const postsState1 = postsContract.posts.get();
    const usersPostsCountersRoot1 = usersPostsCountersMap.getRoot();
    const postsRoot1 = postsMap.getRoot();
    expect(allPostsCounterState1).toEqual(Field(1));
    expect(allPostsCounterState1).not.toEqual(allPostsCounterState);
    expect(usersPostsCountersState1).toEqual(usersPostsCountersRoot1);
    expect(usersPostsCountersState1).not.toEqual(usersPostsCountersState);
    expect(postsState1).toEqual(postsRoot1);
    expect(postsState1).not.toEqual(postsRoot);

    console.log('1st post published');

    // ==============================================================================
    // 3. Publishes on-chain proof for deletion of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createPostDeletionTransitionValidInputs(
      user1Key,
      Field(1),
      valid1.postState,
      Field(1),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition2 = PostsTransition.createPostDeletionTransition(
      valid2.signature,
      valid2.allPostsCounter,
      valid2.usersPostsCounters,
      valid2.initialPosts,
      valid2.latestPosts,
      valid2.initialPostState,
      valid2.postWitness,
      valid2.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof2: any;
    if (PROOFS_ENABLED) {
      proof2 = await Posts.provePostDeletionTransition(
        transition2,
        valid2.signature,
        valid2.allPostsCounter,
        valid2.usersPostsCounters,
        valid2.initialPosts,
        valid2.latestPosts,
        valid2.initialPostState,
        valid2.postWitness,
        valid2.latestPostState.deletionBlockHeight
      );
    } else {
      proof2 = {
        verify: () => {},
        publicInput: {
          blockHeight: transition2.blockHeight,
          initialAllPostsCounter: transition2.initialAllPostsCounter,
          latestAllPostsCounter: transition2.latestAllPostsCounter,
          initialUsersPostsCounters: transition2.initialUsersPostsCounters,
          latestUsersPostsCounters: transition2.latestUsersPostsCounters,
          initialPosts: transition2.initialPosts,
          latestPosts: transition2.latestPosts
        }
      };
    }

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(user1Address, async () => {
      postsContract.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(2));

    // Validate expected state
    const allPostsCounterState2 = postsContract.allPostsCounter.get();
    const usersPostsCountersState2 = postsContract.usersPostsCounters.get();
    const postsState2 = postsContract.posts.get();
    const usersPostsCountersRoot2 = usersPostsCountersMap.getRoot();
    const postsRoot2 = postsMap.getRoot();
    expect(allPostsCounterState2).toEqual(allPostsCounterState1);
    expect(usersPostsCountersState2).toEqual(usersPostsCountersRoot2);
    expect(usersPostsCountersState2).toEqual(usersPostsCountersState1);
    expect(postsState2).toEqual(postsRoot2);
    expect(postsState2).not.toEqual(postsRoot1);

    console.log('1st post deleted');

    // ==============================================================================
    // 4. Publishes on-chain proof for restoration of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid3 = createPostRestorationTransitionValidInputs(
      user1Key,
      Field(1),
      valid2.latestPostState,
      Field(2),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition3 = PostsTransition.createPostRestorationTransition(
      valid3.signature,
      valid3.allPostsCounter,
      valid3.usersPostsCounters,
      valid3.initialPosts,
      valid3.latestPosts,
      valid3.initialPostState,
      valid3.postWitness,
      valid3.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof3: any;
    if (PROOFS_ENABLED) {
      proof3 = await Posts.provePostRestorationTransition(
        transition3,
        valid3.signature,
        valid3.allPostsCounter,
        valid3.usersPostsCounters,
        valid3.initialPosts,
        valid3.latestPosts,
        valid3.initialPostState,
        valid3.postWitness,
        valid3.restorationBlockHeight
      );
  
    } else {
      proof3 = {
        verify: () => {},
        publicInput: {
          blockHeight: transition3.blockHeight,
          initialAllPostsCounter: transition3.initialAllPostsCounter,
          latestAllPostsCounter: transition3.latestAllPostsCounter,
          initialUsersPostsCounters: transition3.initialUsersPostsCounters,
          latestUsersPostsCounters: transition3.latestUsersPostsCounters,
          initialPosts: transition3.initialPosts,
          latestPosts: transition3.latestPosts
        }
      };
    }
    // Send valid proof to update our on-chain state
    const txn3 = await Mina.transaction(user1Address, async () => {
      postsContract.update(proof3);
    });
    await txn3.prove();
    await txn3.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(3));

    // Validate expected state
    const allPostsCounterState3 = postsContract.allPostsCounter.get();
    const usersPostsCountersState3 = postsContract.usersPostsCounters.get();
    const postsState3 = postsContract.posts.get();
    const usersPostsCountersRoot3 = usersPostsCountersMap.getRoot();
    const postsRoot3 = postsMap.getRoot();
    expect(allPostsCounterState3).toEqual(allPostsCounterState2);
    expect(usersPostsCountersState3).toEqual(usersPostsCountersRoot3);
    expect(usersPostsCountersState3).toEqual(usersPostsCountersState2);
    expect(postsState3).toEqual(postsRoot3);
    expect(postsState3).not.toEqual(postsState2);

    console.log('1st post restored');

    // ==============================================================================
    // 5. Publishes on-chain proof (from merged proofs) for publication of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid4 = createPostPublishingTransitionValidInputs(
      user1Address,
      user1Key,
      CircuitString.fromString(
        'b3333333333333333333333333333333333333333333333333333333333'
      ),
      Field(2),
      Field(2),
      Field(3),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition4 = PostsTransition.createPostPublishingTransition(
      valid4.signature,
      valid4.postState.allPostsCounter.sub(1),
      valid4.initialUsersPostsCounters,
      valid4.latestUsersPostsCounters,
      valid4.postState.userPostsCounter.sub(1),
      valid4.userPostsCounterWitness,
      valid4.initialPosts,
      valid4.latestPosts,
      valid4.postState,
      valid4.postWitness
    );

    // Create valid proof for our state transition
    let proof4: any;
    if (PROOFS_ENABLED) {
      proof4 = await Posts.provePostPublishingTransition(
        transition4,
        valid4.signature,
        valid4.postState.allPostsCounter.sub(1),
        valid4.initialUsersPostsCounters,
        valid4.latestUsersPostsCounters,
        valid4.postState.userPostsCounter.sub(1),
        valid4.userPostsCounterWitness,
        valid4.initialPosts,
        valid4.latestPosts,
        valid4.postState,
        valid4.postWitness
      );
    } else {
      proof4 = {
        verify: () => {},
        publicInput: {
          blockHeight: transition4.blockHeight,
          initialAllPostsCounter: transition4.initialAllPostsCounter,
          latestAllPostsCounter: transition4.latestAllPostsCounter,
          initialUsersPostsCounters: transition4.initialUsersPostsCounters,
          latestUsersPostsCounters: transition4.latestUsersPostsCounters,
          initialPosts: transition4.initialPosts,
          latestPosts: transition4.latestPosts
        }
      };
    }

    // Prepare inputs to create a valid state transition
    const valid5 = createPostPublishingTransitionValidInputs(
      user2Address,
      user2Key,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(3),
      Field(1),
      Field(3),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition5 = PostsTransition.createPostPublishingTransition(
      valid5.signature,
      valid5.postState.allPostsCounter.sub(1),
      valid5.initialUsersPostsCounters,
      valid5.latestUsersPostsCounters,
      valid5.postState.userPostsCounter.sub(1),
      valid5.userPostsCounterWitness,
      valid5.initialPosts,
      valid5.latestPosts,
      valid5.postState,
      valid5.postWitness
    );

    // Create valid proof for our state transition
    let proof5: any;
    if (PROOFS_ENABLED) {
      proof5 = await Posts.provePostPublishingTransition(
        transition5,
        valid5.signature,
        valid5.postState.allPostsCounter.sub(1),
        valid5.initialUsersPostsCounters,
        valid5.latestUsersPostsCounters,
        valid5.postState.userPostsCounter.sub(1),
        valid5.userPostsCounterWitness,
        valid5.initialPosts,
        valid5.latestPosts,
        valid5.postState,
        valid5.postWitness
      );
    } else {
      proof5 = {
        verify: () => {},
        publicInput: {
          blockHeight: transition5.blockHeight,
          initialAllPostsCounter: transition5.initialAllPostsCounter,
          latestAllPostsCounter: transition5.latestAllPostsCounter,
          initialUsersPostsCounters: transition5.initialUsersPostsCounters,
          latestUsersPostsCounters: transition5.latestUsersPostsCounters,
          initialPosts: transition5.initialPosts,
          latestPosts: transition5.latestPosts
        }
      };
    }

    // Merge valid state transitions
    const mergedTransitions1 = PostsTransition.mergePostsTransitions(
      transition4,
      transition5
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs1:any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs1 = await Posts.proveMergedPostsTransitions(
        mergedTransitions1,
        proof4,
        proof5
      );
    } else {
        mergedTransitionProofs1 = {
          verify: () => {},
          publicInput: {
            blockHeight: mergedTransitions1.blockHeight,
            initialAllPostsCounter: mergedTransitions1.initialAllPostsCounter,
            latestAllPostsCounter: mergedTransitions1.latestAllPostsCounter,
            initialUsersPostsCounters: mergedTransitions1.initialUsersPostsCounters,
            latestUsersPostsCounters: mergedTransitions1.latestUsersPostsCounters,
            initialPosts: mergedTransitions1.initialPosts,
            latestPosts: mergedTransitions1.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn4 = await Mina.transaction(user1Address, async () => {
      postsContract.update(mergedTransitionProofs1);
    });
    await txn4.prove();
    await txn4.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(4));

    // Validate expected state
    const allPostsCounterState4 = postsContract.allPostsCounter.get();
    const usersPostsCountersState4 = postsContract.usersPostsCounters.get();
    const postsState4 = postsContract.posts.get();
    const usersPostsCountersRoot4 = usersPostsCountersMap.getRoot();
    const postsRoot4 = postsMap.getRoot();
    expect(allPostsCounterState4).toEqual(Field(3));
    expect(allPostsCounterState4).not.toEqual(allPostsCounterState3);
    expect(usersPostsCountersState4).toEqual(usersPostsCountersRoot4);
    expect(usersPostsCountersState4).not.toEqual(usersPostsCountersState3);
    expect(postsState4).toEqual(postsRoot4);
    expect(postsState4).not.toEqual(postsState3);

    console.log('2nd and 3rd posts published through merged proofs');

    // ==============================================================================
    // 5. Publishes on-chain proof (from merged proofs) for deletion of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid6 = createPostDeletionTransitionValidInputs(
      user1Key,
      Field(3),
      valid4.postState,
      Field(4),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition6 = PostsTransition.createPostDeletionTransition(
      valid6.signature,
      valid6.allPostsCounter,
      valid6.usersPostsCounters,
      valid6.initialPosts,
      valid6.latestPosts,
      valid6.initialPostState,
      valid6.postWitness,
      valid6.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof6: any;
    if (PROOFS_ENABLED) {
      proof6 = await Posts.provePostDeletionTransition(
        transition6,
        valid6.signature,
        valid6.allPostsCounter,
        valid6.usersPostsCounters,
        valid6.initialPosts,
        valid6.latestPosts,
        valid6.initialPostState,
        valid6.postWitness,
        valid6.latestPostState.deletionBlockHeight
      );
    } else {
        proof6 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition6.blockHeight,
            initialAllPostsCounter: transition6.initialAllPostsCounter,
            latestAllPostsCounter: transition6.latestAllPostsCounter,
            initialUsersPostsCounters: transition6.initialUsersPostsCounters,
            latestUsersPostsCounters: transition6.latestUsersPostsCounters,
            initialPosts: transition6.initialPosts,
            latestPosts: transition6.latestPosts
          }
        };
    }

    // Prepare inputs to create a valid state transition
    const valid7 = createPostDeletionTransitionValidInputs(
      user2Key,
      Field(3),
      valid5.postState,
      Field(4),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition7 = PostsTransition.createPostDeletionTransition(
      valid7.signature,
      valid7.allPostsCounter,
      valid7.usersPostsCounters,
      valid7.initialPosts,
      valid7.latestPosts,
      valid7.initialPostState,
      valid7.postWitness,
      valid7.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof7: any;
    if (PROOFS_ENABLED) {
      proof7 = await Posts.provePostDeletionTransition(
        transition7,
        valid7.signature,
        valid7.allPostsCounter,
        valid7.usersPostsCounters,
        valid7.initialPosts,
        valid7.latestPosts,
        valid7.initialPostState,
        valid7.postWitness,
        valid7.latestPostState.deletionBlockHeight
      );
    } else {
      proof7 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition7.blockHeight,
            initialAllPostsCounter: transition7.initialAllPostsCounter,
            latestAllPostsCounter: transition7.latestAllPostsCounter,
            initialUsersPostsCounters: transition7.initialUsersPostsCounters,
            latestUsersPostsCounters: transition7.latestUsersPostsCounters,
            initialPosts: transition7.initialPosts,
            latestPosts: transition7.latestPosts
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions2 = PostsTransition.mergePostsTransitions(
      transition6,
      transition7
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs2: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs2 = await Posts.proveMergedPostsTransitions(
        mergedTransitions2,
        proof6,
        proof7
      );
    } else {
        mergedTransitionProofs2 = {
          verify: () => {},
          publicInput: {
            blockHeight: mergedTransitions2.blockHeight,
            initialAllPostsCounter: mergedTransitions2.initialAllPostsCounter,
            latestAllPostsCounter: mergedTransitions2.latestAllPostsCounter,
            initialUsersPostsCounters: mergedTransitions2.initialUsersPostsCounters,
            latestUsersPostsCounters: mergedTransitions2.latestUsersPostsCounters,
            initialPosts: mergedTransitions2.initialPosts,
            latestPosts: mergedTransitions2.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn5 = await Mina.transaction(user1Address, async () => {
      postsContract.update(mergedTransitionProofs2);
    });
    await txn5.prove();
    await txn5.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(5));

    // Validate expected state
    const allPostsCounterState5 = postsContract.allPostsCounter.get();
    const usersPostsCountersState5 = postsContract.usersPostsCounters.get();
    const postsState5 = postsContract.posts.get();
    const usersPostsCountersRoot5 = usersPostsCountersMap.getRoot();
    const postsRoot5 = postsMap.getRoot();
    expect(allPostsCounterState5).toEqual(allPostsCounterState4);
    expect(usersPostsCountersState5).toEqual(usersPostsCountersRoot5);
    expect(usersPostsCountersState5).toEqual(usersPostsCountersState4);
    expect(postsState5).toEqual(postsRoot5);
    expect(postsState5).not.toEqual(postsState4);

    console.log('2nd and 3rd posts deleted through merged proofs');

    // ==============================================================================
    // 6. Publishes on-chain proof (from merged proofs) for restoration of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid8 = createPostRestorationTransitionValidInputs(
      user1Key,
      Field(3),
      valid6.latestPostState,
      Field(5),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition8 = PostsTransition.createPostRestorationTransition(
      valid8.signature,
      valid8.allPostsCounter,
      valid8.usersPostsCounters,
      valid8.initialPosts,
      valid8.latestPosts,
      valid8.initialPostState,
      valid8.postWitness,
      valid8.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof8: any;
    if (PROOFS_ENABLED) {
      proof8 = await Posts.provePostRestorationTransition(
        transition8,
        valid8.signature,
        valid8.allPostsCounter,
        valid8.usersPostsCounters,
        valid8.initialPosts,
        valid8.latestPosts,
        valid8.initialPostState,
        valid8.postWitness,
        valid8.restorationBlockHeight
      );
    } else {
      proof8 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition8.blockHeight,
            initialAllPostsCounter: transition8.initialAllPostsCounter,
            latestAllPostsCounter: transition8.latestAllPostsCounter,
            initialUsersPostsCounters: transition8.initialUsersPostsCounters,
            latestUsersPostsCounters: transition8.latestUsersPostsCounters,
            initialPosts: transition8.initialPosts,
            latestPosts: transition8.latestPosts
          }
        };
    }

    // Prepare inputs to create a valid state transition
    const valid9 = createPostRestorationTransitionValidInputs(
      user2Key,
      Field(3),
      valid7.latestPostState,
      Field(5),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition9 = PostsTransition.createPostRestorationTransition(
      valid9.signature,
      valid9.allPostsCounter,
      valid9.usersPostsCounters,
      valid9.initialPosts,
      valid9.latestPosts,
      valid9.initialPostState,
      valid9.postWitness,
      valid9.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof9: any;
    if (PROOFS_ENABLED) {
      proof9 = await Posts.provePostRestorationTransition(
        transition9,
        valid9.signature,
        valid9.allPostsCounter,
        valid9.usersPostsCounters,
        valid9.initialPosts,
        valid9.latestPosts,
        valid9.initialPostState,
        valid9.postWitness,
        valid9.restorationBlockHeight
      );
    } else {
        proof9 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition9.blockHeight,
            initialAllPostsCounter: transition9.initialAllPostsCounter,
            latestAllPostsCounter: transition9.latestAllPostsCounter,
            initialUsersPostsCounters: transition9.initialUsersPostsCounters,
            latestUsersPostsCounters: transition9.latestUsersPostsCounters,
            initialPosts: transition9.initialPosts,
            latestPosts: transition9.latestPosts
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions3 = PostsTransition.mergePostsTransitions(
      transition8,
      transition9
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs3: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs3 = await Posts.proveMergedPostsTransitions(
        mergedTransitions3,
        proof8,
        proof9
      );
    } else {
        mergedTransitionProofs3 = {
          verify: () => {},
          publicInput: {
            blockHeight: mergedTransitions3.blockHeight,
            initialAllPostsCounter: mergedTransitions3.initialAllPostsCounter,
            latestAllPostsCounter: mergedTransitions3.latestAllPostsCounter,
            initialUsersPostsCounters: mergedTransitions3.initialUsersPostsCounters,
            latestUsersPostsCounters: mergedTransitions3.latestUsersPostsCounters,
            initialPosts: mergedTransitions3.initialPosts,
            latestPosts: mergedTransitions3.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn6 = await Mina.transaction(user1Address, async () => {
      postsContract.update(mergedTransitionProofs3);
    });
    await txn6.prove();
    await txn6.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(6));

    // Validate expected state
    const allPostsCounterState6 = postsContract.allPostsCounter.get();
    const usersPostsCountersState6 = postsContract.usersPostsCounters.get();
    const postsState6 = postsContract.posts.get();
    const usersPostsCountersRoot6 = usersPostsCountersMap.getRoot();
    const postsRoot6 = postsMap.getRoot();
    expect(allPostsCounterState6).toEqual(allPostsCounterState5);
    expect(usersPostsCountersState6).toEqual(usersPostsCountersRoot6);
    expect(usersPostsCountersState6).toEqual(usersPostsCountersState5);
    expect(postsState6).toEqual(postsRoot6);
    expect(postsState6).not.toEqual(postsState5);

    console.log('2nd and 3rd posts restored through merged proofs');

    // ==============================================================================
    // 7. Publishes on-chain proof for deletion of 2nd post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid10 = createPostDeletionTransitionValidInputs(
      user1Key,
      Field(3),
      valid8.latestPostState,
      Field(6),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition10 = PostsTransition.createPostDeletionTransition(
      valid10.signature,
      valid10.allPostsCounter,
      valid10.usersPostsCounters,
      valid10.initialPosts,
      valid10.latestPosts,
      valid10.initialPostState,
      valid10.postWitness,
      valid10.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof10: any ;
    if (PROOFS_ENABLED) {
      proof10 = await Posts.provePostDeletionTransition(
        transition10,
        valid10.signature,
        valid10.allPostsCounter,
        valid10.usersPostsCounters,
        valid10.initialPosts,
        valid10.latestPosts,
        valid10.initialPostState,
        valid10.postWitness,
        valid10.latestPostState.deletionBlockHeight
      );
    } else {
        proof10 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition10.blockHeight,
            initialAllPostsCounter: transition10.initialAllPostsCounter,
            latestAllPostsCounter: transition10.latestAllPostsCounter,
            initialUsersPostsCounters: transition10.initialUsersPostsCounters,
            latestUsersPostsCounters: transition10.latestUsersPostsCounters,
            initialPosts: transition10.initialPosts,
            latestPosts: transition10.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn7 = await Mina.transaction(user1Address, async () => {
      postsContract.update(proof10);
    });
    await txn7.prove();
    await txn7.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(7));

    // Validate expected state
    const allPostsCounterState7 = postsContract.allPostsCounter.get();
    const usersPostsCountersState7 = postsContract.usersPostsCounters.get();
    const postsState7 = postsContract.posts.get();
    const usersPostsCountersRoot7 = usersPostsCountersMap.getRoot();
    const postsRoot7 = postsMap.getRoot();
    expect(allPostsCounterState7).toEqual(allPostsCounterState6);
    expect(usersPostsCountersState7).toEqual(usersPostsCountersRoot7);
    expect(usersPostsCountersState7).toEqual(usersPostsCountersState6);
    expect(postsState7).toEqual(postsRoot7);
    expect(postsState7).not.toEqual(postsState6);

    console.log('2nd post deleted');

    // ==============================================================================
    // 8. Publishes on-chain proof (from merged proofs) for restoration of 2nd post,
    //    and deletion of 3rd post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid11 = createPostRestorationTransitionValidInputs(
      user1Key,
      Field(3),
      valid10.latestPostState,
      Field(7),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition11 = PostsTransition.createPostRestorationTransition(
      valid11.signature,
      valid11.allPostsCounter,
      valid11.usersPostsCounters,
      valid11.initialPosts,
      valid11.latestPosts,
      valid11.initialPostState,
      valid11.postWitness,
      valid11.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof11: any;
    if (PROOFS_ENABLED) {
      proof11 = await Posts.provePostRestorationTransition(
        transition11,
        valid11.signature,
        valid11.allPostsCounter,
        valid11.usersPostsCounters,
        valid11.initialPosts,
        valid11.latestPosts,
        valid11.initialPostState,
        valid11.postWitness,
        valid11.restorationBlockHeight
      );
    } else {
      proof11 = {
        verify: () => {},
        publicInput: {
          blockHeight: transition11.blockHeight,
          initialAllPostsCounter: transition11.initialAllPostsCounter,
          latestAllPostsCounter: transition11.latestAllPostsCounter,
          initialUsersPostsCounters: transition11.initialUsersPostsCounters,
          latestUsersPostsCounters: transition11.latestUsersPostsCounters,
          initialPosts: transition11.initialPosts,
          latestPosts: transition11.latestPosts
        }
      };
    }

    // Prepare inputs to create a valid state transition
    const valid12 = createPostDeletionTransitionValidInputs(
      user2Key,
      Field(3),
      valid9.latestPostState,
      Field(7),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition12 = PostsTransition.createPostDeletionTransition(
      valid12.signature,
      valid12.allPostsCounter,
      valid12.usersPostsCounters,
      valid12.initialPosts,
      valid12.latestPosts,
      valid12.initialPostState,
      valid12.postWitness,
      valid12.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof12: any;
    if (PROOFS_ENABLED) {
      proof12 = await Posts.provePostDeletionTransition(
        transition12,
        valid12.signature,
        valid12.allPostsCounter,
        valid12.usersPostsCounters,
        valid12.initialPosts,
        valid12.latestPosts,
        valid12.initialPostState,
        valid12.postWitness,
        valid12.latestPostState.deletionBlockHeight
      );
    } else {
        proof12 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition12.blockHeight,
            initialAllPostsCounter: transition12.initialAllPostsCounter,
            latestAllPostsCounter: transition12.latestAllPostsCounter,
            initialUsersPostsCounters: transition12.initialUsersPostsCounters,
            latestUsersPostsCounters: transition12.latestUsersPostsCounters,
            initialPosts: transition12.initialPosts,
            latestPosts: transition12.latestPosts
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions4 = PostsTransition.mergePostsTransitions(
      transition11,
      transition12
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs4: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs4 = await Posts.proveMergedPostsTransitions(
        mergedTransitions4,
        proof11,
        proof12
      );
    } else {
        mergedTransitionProofs4 = {
          verify: () => {},
          publicInput: {
            blockHeight: mergedTransitions4.blockHeight,
            initialAllPostsCounter: mergedTransitions4.initialAllPostsCounter,
            latestAllPostsCounter: mergedTransitions4.latestAllPostsCounter,
            initialUsersPostsCounters: mergedTransitions4.initialUsersPostsCounters,
            latestUsersPostsCounters: mergedTransitions4.latestUsersPostsCounters,
            initialPosts: mergedTransitions4.initialPosts,
            latestPosts: mergedTransitions4.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn8 = await Mina.transaction(user1Address, async () => {
      postsContract.update(mergedTransitionProofs4);
    });
    await txn8.prove();
    await txn8.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(8));

    // Validate expected state
    const allPostsCounterState8 = postsContract.allPostsCounter.get();
    const usersPostsCountersState8 = postsContract.usersPostsCounters.get();
    const postsState8 = postsContract.posts.get();
    const usersPostsCountersRoot8 = usersPostsCountersMap.getRoot();
    const postsRoot8 = postsMap.getRoot();
    expect(allPostsCounterState8).toEqual(allPostsCounterState7);
    expect(usersPostsCountersState8).toEqual(usersPostsCountersRoot8);
    expect(usersPostsCountersState8).toEqual(usersPostsCountersState7);
    expect(postsState8).toEqual(postsRoot8);
    expect(postsState8).not.toEqual(postsState7);

    console.log('2nd and 3rd posts restored and deleted, respectively');

    // ==============================================================================
    // 9. Publishes on-chain proof (from merged proofs) for restoration of 3rd post,
    //    and publication of 4th post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid13 = createPostRestorationTransitionValidInputs(
      user2Key,
      Field(3),
      valid12.latestPostState,
      Field(8),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition13 = PostsTransition.createPostRestorationTransition(
      valid13.signature,
      valid13.allPostsCounter,
      valid13.usersPostsCounters,
      valid13.initialPosts,
      valid13.latestPosts,
      valid13.initialPostState,
      valid13.postWitness,
      valid13.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof13: any;
    if (PROOFS_ENABLED) {
      proof13 = await Posts.provePostRestorationTransition(
        transition13,
        valid13.signature,
        valid13.allPostsCounter,
        valid13.usersPostsCounters,
        valid13.initialPosts,
        valid13.latestPosts,
        valid13.initialPostState,
        valid13.postWitness,
        valid13.restorationBlockHeight
      );
    } else {
        proof13 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition13.blockHeight,
            initialAllPostsCounter: transition13.initialAllPostsCounter,
            latestAllPostsCounter: transition13.latestAllPostsCounter,
            initialUsersPostsCounters: transition13.initialUsersPostsCounters,
            latestUsersPostsCounters: transition13.latestUsersPostsCounters,
            initialPosts: transition13.initialPosts,
            latestPosts: transition13.latestPosts
          }
        };
    }

    // Prepare inputs to create a valid state transition
    const valid14 = createPostPublishingTransitionValidInputs(
      user2Address,
      user2Key,
      CircuitString.fromString(
        'b4444444444444444444444444444444444444444444444444444444444'
      ),
      Field(4),
      Field(2),
      Field(8),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
    const transition14 = PostsTransition.createPostPublishingTransition(
      valid14.signature,
      valid14.postState.allPostsCounter.sub(1),
      valid14.initialUsersPostsCounters,
      valid14.latestUsersPostsCounters,
      valid14.postState.userPostsCounter.sub(1),
      valid14.userPostsCounterWitness,
      valid14.initialPosts,
      valid14.latestPosts,
      valid14.postState,
      valid14.postWitness
    );

    // Create valid proof for our state transition
    let proof14: any;
    if (PROOFS_ENABLED) {
      proof14 = await Posts.provePostPublishingTransition(
        transition14,
        valid14.signature,
        valid14.postState.allPostsCounter.sub(1),
        valid14.initialUsersPostsCounters,
        valid14.latestUsersPostsCounters,
        valid14.postState.userPostsCounter.sub(1),
        valid14.userPostsCounterWitness,
        valid14.initialPosts,
        valid14.latestPosts,
        valid14.postState,
        valid14.postWitness
      );
    } else {
        proof14 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition14.blockHeight,
            initialAllPostsCounter: transition14.initialAllPostsCounter,
            latestAllPostsCounter: transition14.latestAllPostsCounter,
            initialUsersPostsCounters: transition14.initialUsersPostsCounters,
            latestUsersPostsCounters: transition14.latestUsersPostsCounters,
            initialPosts: transition14.initialPosts,
            latestPosts: transition14.latestPosts
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions5 = PostsTransition.mergePostsTransitions(
      transition13,
      transition14
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs5: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs5 = await Posts.proveMergedPostsTransitions(
        mergedTransitions5,
        proof13,
        proof14
      );
    } else {
      mergedTransitionProofs5 = {
        verify: () => {},
        publicInput: {
          blockHeight: mergedTransitions5.blockHeight,
          initialAllPostsCounter: mergedTransitions5.initialAllPostsCounter,
          latestAllPostsCounter: mergedTransitions5.latestAllPostsCounter,
          initialUsersPostsCounters: mergedTransitions5.initialUsersPostsCounters,
          latestUsersPostsCounters: mergedTransitions5.latestUsersPostsCounters,
          initialPosts: mergedTransitions5.initialPosts,
          latestPosts: mergedTransitions5.latestPosts
        }
      };
    }

    // Send valid proof to update our on-chain state
    const txn9 = await Mina.transaction(user1Address, async () => {
      postsContract.update(mergedTransitionProofs5);
    });
    await txn9.prove();
    await txn9.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(9));

    // Validate expected state
    const allPostsCounterState9 = postsContract.allPostsCounter.get();
    const usersPostsCountersState9 = postsContract.usersPostsCounters.get();
    const postsState9 = postsContract.posts.get();
    const usersPostsCountersRoot9 = usersPostsCountersMap.getRoot();
    const postsRoot9 = postsMap.getRoot();
    expect(allPostsCounterState9).toEqual(Field(4));
    expect(allPostsCounterState9).not.toEqual(allPostsCounterState8);
    expect(usersPostsCountersState9).toEqual(usersPostsCountersRoot9);
    expect(usersPostsCountersState9).not.toEqual(usersPostsCountersState8);
    expect(postsState9).toEqual(postsRoot9);
    expect(postsState9).not.toEqual(postsState8);

    console.log('3rd and 4th posts restored and publicated, respectively');

    // ==============================================================================
    // 10. Extra validation for all the state updates so far.
    // ==============================================================================

    const newUsersPostsCountersMap = new MerkleMap();
    const user1AddressAsField = Poseidon.hash(user1Address.toFields());
    const user2AddressAsField = Poseidon.hash(user2Address.toFields());
    newUsersPostsCountersMap.set(user1AddressAsField, Field(2));
    newUsersPostsCountersMap.set(user2AddressAsField, Field(2));
    expect(newUsersPostsCountersMap.getRoot()).toEqual(
      usersPostsCountersState9
    );

    const post1 = new PostState({
      posterAddress: valid3.latestPostState.posterAddress,
      postContentID: valid3.latestPostState.postContentID,
      allPostsCounter: valid3.latestPostState.allPostsCounter,
      userPostsCounter: valid3.latestPostState.userPostsCounter,
      postBlockHeight: valid3.latestPostState.postBlockHeight,
      deletionBlockHeight: valid3.latestPostState.deletionBlockHeight,
      restorationBlockHeight: valid3.latestPostState.restorationBlockHeight,
    });
    const post2 = new PostState({
      posterAddress: valid11.latestPostState.posterAddress,
      postContentID: valid11.latestPostState.postContentID,
      allPostsCounter: valid11.latestPostState.allPostsCounter,
      userPostsCounter: valid11.latestPostState.userPostsCounter,
      postBlockHeight: valid11.latestPostState.postBlockHeight,
      deletionBlockHeight: valid11.latestPostState.deletionBlockHeight,
      restorationBlockHeight: valid11.latestPostState.restorationBlockHeight,
    });
    const post3 = new PostState({
      posterAddress: valid13.latestPostState.posterAddress,
      postContentID: valid13.latestPostState.postContentID,
      allPostsCounter: valid13.latestPostState.allPostsCounter,
      userPostsCounter: valid13.latestPostState.userPostsCounter,
      postBlockHeight: valid13.latestPostState.postBlockHeight,
      deletionBlockHeight: valid13.latestPostState.deletionBlockHeight,
      restorationBlockHeight: valid13.latestPostState.restorationBlockHeight,
    });
    const post4 = new PostState({
      posterAddress: valid14.postState.posterAddress,
      postContentID: valid14.postState.postContentID,
      allPostsCounter: valid14.postState.allPostsCounter,
      userPostsCounter: valid14.postState.userPostsCounter,
      postBlockHeight: valid14.postState.postBlockHeight,
      deletionBlockHeight: valid14.postState.deletionBlockHeight,
      restorationBlockHeight: valid14.postState.restorationBlockHeight,
    });

    const newPostsMap = new MerkleMap();
    newPostsMap.set(
      Poseidon.hash([user1AddressAsField, post1.postContentID.hash()]),
      post1.hash()
    );
    newPostsMap.set(
      Poseidon.hash([user1AddressAsField, post2.postContentID.hash()]),
      post2.hash()
    );
    newPostsMap.set(
      Poseidon.hash([user2AddressAsField, post3.postContentID.hash()]),
      post3.hash()
    );
    newPostsMap.set(
      Poseidon.hash([user2AddressAsField, post4.postContentID.hash()]),
      post4.hash()
    );

    expect(newPostsMap.getRoot()).toEqual(postsState9);

    console.log('Successful extra validation of all the state updates');
  });
});
