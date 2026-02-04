# GetEventPayloadByStage200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Payload UUID | 
**EventId** | **string** | Event UUID | 
**Stage** | **string** | Payload stage | 
**MimeType** | **string** | MIME type | 
**SizeBytes** | **int32** | Size in bytes | 
**HasData** | **bool** | Whether data is available | 
**CreatedAt** | **time.Time** | Creation timestamp | 
**Payload** | Pointer to **interface{}** | Decompressed payload data | [optional] 

## Methods

### NewGetEventPayloadByStage200ResponseData

`func NewGetEventPayloadByStage200ResponseData(id string, eventId string, stage string, mimeType string, sizeBytes int32, hasData bool, createdAt time.Time, ) *GetEventPayloadByStage200ResponseData`

NewGetEventPayloadByStage200ResponseData instantiates a new GetEventPayloadByStage200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetEventPayloadByStage200ResponseDataWithDefaults

`func NewGetEventPayloadByStage200ResponseDataWithDefaults() *GetEventPayloadByStage200ResponseData`

NewGetEventPayloadByStage200ResponseDataWithDefaults instantiates a new GetEventPayloadByStage200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *GetEventPayloadByStage200ResponseData) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *GetEventPayloadByStage200ResponseData) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *GetEventPayloadByStage200ResponseData) SetId(v string)`

SetId sets Id field to given value.


### GetEventId

`func (o *GetEventPayloadByStage200ResponseData) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *GetEventPayloadByStage200ResponseData) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *GetEventPayloadByStage200ResponseData) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetStage

`func (o *GetEventPayloadByStage200ResponseData) GetStage() string`

GetStage returns the Stage field if non-nil, zero value otherwise.

### GetStageOk

`func (o *GetEventPayloadByStage200ResponseData) GetStageOk() (*string, bool)`

GetStageOk returns a tuple with the Stage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStage

`func (o *GetEventPayloadByStage200ResponseData) SetStage(v string)`

SetStage sets Stage field to given value.


### GetMimeType

`func (o *GetEventPayloadByStage200ResponseData) GetMimeType() string`

GetMimeType returns the MimeType field if non-nil, zero value otherwise.

### GetMimeTypeOk

`func (o *GetEventPayloadByStage200ResponseData) GetMimeTypeOk() (*string, bool)`

GetMimeTypeOk returns a tuple with the MimeType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMimeType

`func (o *GetEventPayloadByStage200ResponseData) SetMimeType(v string)`

SetMimeType sets MimeType field to given value.


### GetSizeBytes

`func (o *GetEventPayloadByStage200ResponseData) GetSizeBytes() int32`

GetSizeBytes returns the SizeBytes field if non-nil, zero value otherwise.

### GetSizeBytesOk

`func (o *GetEventPayloadByStage200ResponseData) GetSizeBytesOk() (*int32, bool)`

GetSizeBytesOk returns a tuple with the SizeBytes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSizeBytes

`func (o *GetEventPayloadByStage200ResponseData) SetSizeBytes(v int32)`

SetSizeBytes sets SizeBytes field to given value.


### GetHasData

`func (o *GetEventPayloadByStage200ResponseData) GetHasData() bool`

GetHasData returns the HasData field if non-nil, zero value otherwise.

### GetHasDataOk

`func (o *GetEventPayloadByStage200ResponseData) GetHasDataOk() (*bool, bool)`

GetHasDataOk returns a tuple with the HasData field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHasData

`func (o *GetEventPayloadByStage200ResponseData) SetHasData(v bool)`

SetHasData sets HasData field to given value.


### GetCreatedAt

`func (o *GetEventPayloadByStage200ResponseData) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *GetEventPayloadByStage200ResponseData) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *GetEventPayloadByStage200ResponseData) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.


### GetPayload

`func (o *GetEventPayloadByStage200ResponseData) GetPayload() interface{}`

GetPayload returns the Payload field if non-nil, zero value otherwise.

### GetPayloadOk

`func (o *GetEventPayloadByStage200ResponseData) GetPayloadOk() (*interface{}, bool)`

GetPayloadOk returns a tuple with the Payload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayload

`func (o *GetEventPayloadByStage200ResponseData) SetPayload(v interface{})`

SetPayload sets Payload field to given value.

### HasPayload

`func (o *GetEventPayloadByStage200ResponseData) HasPayload() bool`

HasPayload returns a boolean if a field has been set.

### SetPayloadNil

`func (o *GetEventPayloadByStage200ResponseData) SetPayloadNil(b bool)`

 SetPayloadNil sets the value for Payload to be an explicit nil

### UnsetPayload
`func (o *GetEventPayloadByStage200ResponseData) UnsetPayload()`

UnsetPayload ensures that no value is present for Payload, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


