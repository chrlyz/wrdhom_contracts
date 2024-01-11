import {
    Field,
    PrivateKey,
    PublicKey,
    MerkleMap,
    Poseidon,
    Signature,
    Bool,
  } from 'o1js';
import { PostState } from '../posts/Posts';
import { RepostState } from './Reposts.js';
import { fieldToFlagTargetAsReposted } from './Reposts.js';

export function createRepostTransitionValidInputs(
    targetState: PostState,
    reposterAddress: PublicKey,
    reposterKey: PrivateKey,
    allRepostsCounter: Field,
    userRepostsCounter: Field,
    targetRepostsCounter: Field,
    repostBlockHeight: Field,
    postsMap: MerkleMap,
    usersRepostsCountersMap: MerkleMap,
    targetsRepostsCountersMap: MerkleMap,
    repostsMap: MerkleMap
) {
    const posterAddressAsField = Poseidon.hash(
        targetState.posterAddress.toFields()
    );
    const postContentIDHash = targetState.postContentID.hash();
    const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

    const signature = Signature.create(reposterKey, [
        targetKey,
        fieldToFlagTargetAsReposted,
    ]);

    const targetWitness = postsMap.getWitness(
        Poseidon.hash([posterAddressAsField, postContentIDHash])
    );

    const initialUsersRepostsCounters = usersRepostsCountersMap.getRoot();
    const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
    usersRepostsCountersMap.set(reposterAddressAsField, userRepostsCounter);
    const latestUsersRepostsCounters = usersRepostsCountersMap.getRoot();
    const userRepostsCounterWitness = usersRepostsCountersMap.getWitness(
        reposterAddressAsField
    );

    const initialTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
    targetsRepostsCountersMap.set(targetKey, targetRepostsCounter);
    const latestTargetsRepostsCounters = targetsRepostsCountersMap.getRoot();
    const targetRepostsCounterWitness =
        targetsRepostsCountersMap.getWitness(targetKey);

    const repostState = new RepostState({
        isTargetPost: new Bool(true),
        targetKey: targetKey,
        reposterAddress: reposterAddress,
        allRepostsCounter: allRepostsCounter,
        userRepostsCounter: userRepostsCounter,
        targetRepostsCounter: targetRepostsCounter,
        repostBlockHeight: repostBlockHeight,
        deletionBlockHeight: Field(0),
        restorationBlockHeight: Field(0),
    });

    const initialReposts = repostsMap.getRoot();
    const repostKey = Poseidon.hash([
        targetKey,
        reposterAddressAsField
    ]);
    repostsMap.set(repostKey, repostState.hash());
    const latestReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(repostKey);

    return {
        signature: signature,
        targetState: targetState,
        targetWitness: targetWitness,
        initialUsersRepostsCounters: initialUsersRepostsCounters,
        latestUsersRepostsCounters: latestUsersRepostsCounters,
        userRepostsCounterWitness: userRepostsCounterWitness,
        initialTargetsRepostsCounters: initialTargetsRepostsCounters,
        latestTargetsRepostsCounters: latestTargetsRepostsCounters,
        targetRepostsCounterWitness: targetRepostsCounterWitness,
        initialReposts: initialReposts,
        latestReposts: latestReposts,
        repostWitness: repostWitness,
        repostState: repostState,
    };
}
