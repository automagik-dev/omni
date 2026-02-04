# SendStickerRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**To** | **string** | Recipient | 
**Url** | Pointer to **string** | Sticker URL | [optional] 
**Base64** | Pointer to **string** | Base64 encoded sticker | [optional] 

## Methods

### NewSendStickerRequest

`func NewSendStickerRequest(instanceId string, to string, ) *SendStickerRequest`

NewSendStickerRequest instantiates a new SendStickerRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendStickerRequestWithDefaults

`func NewSendStickerRequestWithDefaults() *SendStickerRequest`

NewSendStickerRequestWithDefaults instantiates a new SendStickerRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *SendStickerRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SendStickerRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SendStickerRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetTo

`func (o *SendStickerRequest) GetTo() string`

GetTo returns the To field if non-nil, zero value otherwise.

### GetToOk

`func (o *SendStickerRequest) GetToOk() (*string, bool)`

GetToOk returns a tuple with the To field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTo

`func (o *SendStickerRequest) SetTo(v string)`

SetTo sets To field to given value.


### GetUrl

`func (o *SendStickerRequest) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *SendStickerRequest) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *SendStickerRequest) SetUrl(v string)`

SetUrl sets Url field to given value.

### HasUrl

`func (o *SendStickerRequest) HasUrl() bool`

HasUrl returns a boolean if a field has been set.

### GetBase64

`func (o *SendStickerRequest) GetBase64() string`

GetBase64 returns the Base64 field if non-nil, zero value otherwise.

### GetBase64Ok

`func (o *SendStickerRequest) GetBase64Ok() (*string, bool)`

GetBase64Ok returns a tuple with the Base64 field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBase64

`func (o *SendStickerRequest) SetBase64(v string)`

SetBase64 sets Base64 field to given value.

### HasBase64

`func (o *SendStickerRequest) HasBase64() bool`

HasBase64 returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


