import {
    Field,
    SmartContract,
    state,
    State,
    method,
    PublicKey,
    Poseidon,
    MerkleTree,
    MerkleWitness
  } from 'o1js';
  import { PostPublishingTransactionProof, PostsTransition } from './Posts.js';
  import { PostsContract, Config, postsContractAddress } from './PostsContract.js';
  import fs from 'fs/promises';
  
  
  // ============================================================================

  const newMerkleTree = new MerkleTree(256);
  class MerkleWitness256 extends MerkleWitness(256) {}
  
  const configJson: Config = JSON.parse(
    await fs.readFile('config.json', 'utf8')
  );
  const postsSubcontractAConfig = configJson.deployAliases['postsSubcontractA'];
  const postsSubcontractAConfigAddressBase58: { publicKey: string } = JSON.parse(
    await fs.readFile(postsSubcontractAConfig.keyPath, 'utf8')
  );
  export const postsSubcontractAAddress = PublicKey.fromBase58(
    postsSubcontractAConfigAddressBase58.publicKey
  );
  
  // ============================================================================
  
  export class PostsSubcontractA extends SmartContract {
    @state(Field) allPostsCounter = State<Field>();
    @state(Field) usersPostsCounters = State<Field>();
    @state(Field) posts = State<Field>();
    @state(Field) lastValidState = State<Field>();
  
    init() {
      super.init();
      const postsContract = new PostsContract(postsContractAddress);
  
      const allPostsCounterCurrent = postsContract.allPostsCounter.getAndRequireEquals();
      this.allPostsCounter.set(allPostsCounterCurrent);
      
      const usersPostsCountersCurrent = postsContract.usersPostsCounters.getAndRequireEquals();
      this.usersPostsCounters.set(usersPostsCountersCurrent);
  
      const postsCurrent = postsContract.posts.getAndRequireEquals();
      this.posts.set(postsCurrent);
  
      const lastValidStateCurrent = postsContract.lastValidState.getAndRequireEquals();
      this.lastValidState.set(lastValidStateCurrent);
    }

    @method async proveInvalidInitialStateAndRollback(
      postPublishingTransaction1Proof: PostPublishingTransactionProof,
      postPublishingTransaction2Proof: PostPublishingTransactionProof,
      postPublishingTransaction1Witness: MerkleWitness256,
      postPublishingTransaction2Witness: MerkleWitness256,
      allPostsCounter: Field,
      usersPostsCounters: Field,
      posts: Field
    ) {
      const postsContract = new PostsContract(postsContractAddress);
      const postPublishingTransactionsCurrent = postsContract.postPublishingTransactions.getAndRequireEquals();

      const postPublishingTransaction1WitnessRoot = postPublishingTransaction1Witness.calculateRoot(postPublishingTransaction1Proof.publicInput.postPublishingTransactionHash);
      const postPublishingTransaction2WitnessRoot = postPublishingTransaction2Witness.calculateRoot(postPublishingTransaction2Proof.publicInput.postPublishingTransactionHash);
      postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransaction2WitnessRoot);
      postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransactionsCurrent);
  
      const postPublishingTransaction1WitnessIndex = postPublishingTransaction1Witness.calculateIndex();
      const postPublishingTransaction2WitnessIndex = postPublishingTransaction2Witness.calculateIndex();
      postPublishingTransaction2WitnessIndex.assertEquals(postPublishingTransaction1WitnessIndex.add(1));

      const initialAllPostsCounterIsValid = postPublishingTransaction1Proof.publicInput.postPublishingTransaction.transition.latestAllPostsCounter.equals(
        postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.initialAllPostsCounter
      );
      const initialUsersPostsCountersIsValid = postPublishingTransaction1Proof.publicInput.postPublishingTransaction.transition.latestUsersPostsCounters.equals(
        postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.initialUsersPostsCounters
      );
      const initialPostsIsValid = postPublishingTransaction1Proof.publicInput.postPublishingTransaction.transition.latestPosts.equals(
        postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.initialPosts
      );
      const isInitialStateValid = initialAllPostsCounterIsValid.and(initialUsersPostsCountersIsValid).and(initialPostsIsValid);
      isInitialStateValid.assertFalse();

      const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
      const lastValidStateCurrent = this.lastValidState.getAndRequireEquals();
      lastValidState.assertEquals(lastValidStateCurrent);
  
      this.allPostsCounter.set(allPostsCounter);
      this.usersPostsCounters.set(usersPostsCounters);
      this.posts.set(posts);
      this.lastValidState.set(lastValidStateCurrent);
    }

    @method async provePostPublisingTransitionErrorAndRollback(
        postPublishingTransaction1Proof: PostPublishingTransactionProof,
        postPublishingTransaction2Proof: PostPublishingTransactionProof,
        postPublishingTransaction1Witness: MerkleWitness256,
        postPublishingTransaction2Witness: MerkleWitness256,
        allPostsCounter: Field,
        usersPostsCounters: Field,
        posts: Field
      ) {
        const postsContract = new PostsContract(postsContractAddress);
        const postPublishingTransactionsCurrent = postsContract.postPublishingTransactions.getAndRequireEquals();

        const postPublishingTransaction1WitnessRoot = postPublishingTransaction1Witness.calculateRoot(postPublishingTransaction1Proof.publicInput.postPublishingTransactionHash);
        const postPublishingTransaction2WitnessRoot = postPublishingTransaction2Witness.calculateRoot(postPublishingTransaction2Proof.publicInput.postPublishingTransactionHash);
        postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransaction2WitnessRoot);
        postPublishingTransaction1WitnessRoot.assertEquals(postPublishingTransactionsCurrent);
    
        const postPublishingTransaction1WitnessIndex = postPublishingTransaction1Witness.calculateIndex();
        const postPublishingTransaction2WitnessIndex = postPublishingTransaction2Witness.calculateIndex();
        postPublishingTransaction2WitnessIndex.assertEquals(postPublishingTransaction1WitnessIndex.add(1));
        
        const computedTransition =
        PostsTransition.createPostPublishingTransition(
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.signature,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.initialAllPostsCounter,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.initialUsersPostsCounters,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.latestUsersPostsCounters,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.initialUserPostsCounter,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.userPostsCounterWitness,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.initialPosts,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.latestPosts,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.postState,
          postPublishingTransaction2Proof.publicInput.postPublishingTransaction.inputs.postWitness
        );
        const latestAllPostsCounterIsEqual = computedTransition.latestAllPostsCounter.equals(postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.latestAllPostsCounter);
        const latestUsersPostsCountersIsEqual = computedTransition.latestUsersPostsCounters.equals(postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.latestUsersPostsCounters);
        const latestPostsIsEqual = computedTransition.latestPosts.equals(postPublishingTransaction2Proof.publicInput.postPublishingTransaction.transition.latestPosts);
        const isStateValid = latestAllPostsCounterIsEqual.and(latestUsersPostsCountersIsEqual).and(latestPostsIsEqual);
        isStateValid.assertFalse();
    
        const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts]);
        const lastValidStateCurrent = this.lastValidState.getAndRequireEquals();
        lastValidState.assertEquals(lastValidStateCurrent);
    
        this.allPostsCounter.set(allPostsCounter);
        this.usersPostsCounters.set(usersPostsCounters);
        this.posts.set(posts);
        this.lastValidState.set(lastValidStateCurrent);
      }
  }
  