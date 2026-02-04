# PayloadStats

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalPayloads** | **int32** | Total payloads | 
**TotalSizeBytes** | **int32** | Total size | 
**ByStage** | [**GetPayloadStats200ResponseDataByStage**](GetPayloadStats200ResponseDataByStage.md) |  | 
**OldestPayload** | **NullableTime** | Oldest payload date | 

## Methods

### NewPayloadStats

`func NewPayloadStats(totalPayloads int32, totalSizeBytes int32, byStage GetPayloadStats200ResponseDataByStage, oldestPayload NullableTime, ) *PayloadStats`

NewPayloadStats instantiates a new PayloadStats object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPayloadStatsWithDefaults

`func NewPayloadStatsWithDefaults() *PayloadStats`

NewPayloadStatsWithDefaults instantiates a new PayloadStats object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotalPayloads

`func (o *PayloadStats) GetTotalPayloads() int32`

GetTotalPayloads returns the TotalPayloads field if non-nil, zero value otherwise.

### GetTotalPayloadsOk

`func (o *PayloadStats) GetTotalPayloadsOk() (*int32, bool)`

GetTotalPayloadsOk returns a tuple with the TotalPayloads field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalPayloads

`func (o *PayloadStats) SetTotalPayloads(v int32)`

SetTotalPayloads sets TotalPayloads field to given value.


### GetTotalSizeBytes

`func (o *PayloadStats) GetTotalSizeBytes() int32`

GetTotalSizeBytes returns the TotalSizeBytes field if non-nil, zero value otherwise.

### GetTotalSizeBytesOk

`func (o *PayloadStats) GetTotalSizeBytesOk() (*int32, bool)`

GetTotalSizeBytesOk returns a tuple with the TotalSizeBytes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalSizeBytes

`func (o *PayloadStats) SetTotalSizeBytes(v int32)`

SetTotalSizeBytes sets TotalSizeBytes field to given value.


### GetByStage

`func (o *PayloadStats) GetByStage() GetPayloadStats200ResponseDataByStage`

GetByStage returns the ByStage field if non-nil, zero value otherwise.

### GetByStageOk

`func (o *PayloadStats) GetByStageOk() (*GetPayloadStats200ResponseDataByStage, bool)`

GetByStageOk returns a tuple with the ByStage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByStage

`func (o *PayloadStats) SetByStage(v GetPayloadStats200ResponseDataByStage)`

SetByStage sets ByStage field to given value.


### GetOldestPayload

`func (o *PayloadStats) GetOldestPayload() time.Time`

GetOldestPayload returns the OldestPayload field if non-nil, zero value otherwise.

### GetOldestPayloadOk

`func (o *PayloadStats) GetOldestPayloadOk() (*time.Time, bool)`

GetOldestPayloadOk returns a tuple with the OldestPayload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOldestPayload

`func (o *PayloadStats) SetOldestPayload(v time.Time)`

SetOldestPayload sets OldestPayload field to given value.


### SetOldestPayloadNil

`func (o *PayloadStats) SetOldestPayloadNil(b bool)`

 SetOldestPayloadNil sets the value for OldestPayload to be an explicit nil

### UnsetOldestPayload
`func (o *PayloadStats) UnsetOldestPayload()`

UnsetOldestPayload ensures that no value is present for OldestPayload, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


