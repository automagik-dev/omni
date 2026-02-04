# MergePersonsRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**SourcePersonId** | **string** | Person to merge from (will be deleted) | 
**TargetPersonId** | **string** | Person to merge into (will be kept) | 
**Reason** | Pointer to **string** | Reason for merge | [optional] 

## Methods

### NewMergePersonsRequest

`func NewMergePersonsRequest(sourcePersonId string, targetPersonId string, ) *MergePersonsRequest`

NewMergePersonsRequest instantiates a new MergePersonsRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMergePersonsRequestWithDefaults

`func NewMergePersonsRequestWithDefaults() *MergePersonsRequest`

NewMergePersonsRequestWithDefaults instantiates a new MergePersonsRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSourcePersonId

`func (o *MergePersonsRequest) GetSourcePersonId() string`

GetSourcePersonId returns the SourcePersonId field if non-nil, zero value otherwise.

### GetSourcePersonIdOk

`func (o *MergePersonsRequest) GetSourcePersonIdOk() (*string, bool)`

GetSourcePersonIdOk returns a tuple with the SourcePersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSourcePersonId

`func (o *MergePersonsRequest) SetSourcePersonId(v string)`

SetSourcePersonId sets SourcePersonId field to given value.


### GetTargetPersonId

`func (o *MergePersonsRequest) GetTargetPersonId() string`

GetTargetPersonId returns the TargetPersonId field if non-nil, zero value otherwise.

### GetTargetPersonIdOk

`func (o *MergePersonsRequest) GetTargetPersonIdOk() (*string, bool)`

GetTargetPersonIdOk returns a tuple with the TargetPersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTargetPersonId

`func (o *MergePersonsRequest) SetTargetPersonId(v string)`

SetTargetPersonId sets TargetPersonId field to given value.


### GetReason

`func (o *MergePersonsRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *MergePersonsRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *MergePersonsRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *MergePersonsRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


