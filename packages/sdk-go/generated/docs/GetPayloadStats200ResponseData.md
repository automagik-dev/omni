# GetPayloadStats200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalPayloads** | **int32** | Total payloads | 
**TotalSizeBytes** | **int32** | Total size | 
**ByStage** | [**GetPayloadStats200ResponseDataByStage**](GetPayloadStats200ResponseDataByStage.md) |  | 
**OldestPayload** | **NullableTime** | Oldest payload date | 

## Methods

### NewGetPayloadStats200ResponseData

`func NewGetPayloadStats200ResponseData(totalPayloads int32, totalSizeBytes int32, byStage GetPayloadStats200ResponseDataByStage, oldestPayload NullableTime, ) *GetPayloadStats200ResponseData`

NewGetPayloadStats200ResponseData instantiates a new GetPayloadStats200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPayloadStats200ResponseDataWithDefaults

`func NewGetPayloadStats200ResponseDataWithDefaults() *GetPayloadStats200ResponseData`

NewGetPayloadStats200ResponseDataWithDefaults instantiates a new GetPayloadStats200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotalPayloads

`func (o *GetPayloadStats200ResponseData) GetTotalPayloads() int32`

GetTotalPayloads returns the TotalPayloads field if non-nil, zero value otherwise.

### GetTotalPayloadsOk

`func (o *GetPayloadStats200ResponseData) GetTotalPayloadsOk() (*int32, bool)`

GetTotalPayloadsOk returns a tuple with the TotalPayloads field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalPayloads

`func (o *GetPayloadStats200ResponseData) SetTotalPayloads(v int32)`

SetTotalPayloads sets TotalPayloads field to given value.


### GetTotalSizeBytes

`func (o *GetPayloadStats200ResponseData) GetTotalSizeBytes() int32`

GetTotalSizeBytes returns the TotalSizeBytes field if non-nil, zero value otherwise.

### GetTotalSizeBytesOk

`func (o *GetPayloadStats200ResponseData) GetTotalSizeBytesOk() (*int32, bool)`

GetTotalSizeBytesOk returns a tuple with the TotalSizeBytes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalSizeBytes

`func (o *GetPayloadStats200ResponseData) SetTotalSizeBytes(v int32)`

SetTotalSizeBytes sets TotalSizeBytes field to given value.


### GetByStage

`func (o *GetPayloadStats200ResponseData) GetByStage() GetPayloadStats200ResponseDataByStage`

GetByStage returns the ByStage field if non-nil, zero value otherwise.

### GetByStageOk

`func (o *GetPayloadStats200ResponseData) GetByStageOk() (*GetPayloadStats200ResponseDataByStage, bool)`

GetByStageOk returns a tuple with the ByStage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByStage

`func (o *GetPayloadStats200ResponseData) SetByStage(v GetPayloadStats200ResponseDataByStage)`

SetByStage sets ByStage field to given value.


### GetOldestPayload

`func (o *GetPayloadStats200ResponseData) GetOldestPayload() time.Time`

GetOldestPayload returns the OldestPayload field if non-nil, zero value otherwise.

### GetOldestPayloadOk

`func (o *GetPayloadStats200ResponseData) GetOldestPayloadOk() (*time.Time, bool)`

GetOldestPayloadOk returns a tuple with the OldestPayload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOldestPayload

`func (o *GetPayloadStats200ResponseData) SetOldestPayload(v time.Time)`

SetOldestPayload sets OldestPayload field to given value.


### SetOldestPayloadNil

`func (o *GetPayloadStats200ResponseData) SetOldestPayloadNil(b bool)`

 SetOldestPayloadNil sets the value for OldestPayload to be an explicit nil

### UnsetOldestPayload
`func (o *GetPayloadStats200ResponseData) UnsetOldestPayload()`

UnsetOldestPayload ensures that no value is present for OldestPayload, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


