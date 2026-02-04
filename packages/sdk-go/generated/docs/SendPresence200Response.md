# SendPresence200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Success** | **bool** |  | 
**Data** | [**SendPresence200ResponseData**](SendPresence200ResponseData.md) |  | 

## Methods

### NewSendPresence200Response

`func NewSendPresence200Response(success bool, data SendPresence200ResponseData, ) *SendPresence200Response`

NewSendPresence200Response instantiates a new SendPresence200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSendPresence200ResponseWithDefaults

`func NewSendPresence200ResponseWithDefaults() *SendPresence200Response`

NewSendPresence200ResponseWithDefaults instantiates a new SendPresence200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSuccess

`func (o *SendPresence200Response) GetSuccess() bool`

GetSuccess returns the Success field if non-nil, zero value otherwise.

### GetSuccessOk

`func (o *SendPresence200Response) GetSuccessOk() (*bool, bool)`

GetSuccessOk returns a tuple with the Success field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSuccess

`func (o *SendPresence200Response) SetSuccess(v bool)`

SetSuccess sets Success field to given value.


### GetData

`func (o *SendPresence200Response) GetData() SendPresence200ResponseData`

GetData returns the Data field if non-nil, zero value otherwise.

### GetDataOk

`func (o *SendPresence200Response) GetDataOk() (*SendPresence200ResponseData, bool)`

GetDataOk returns a tuple with the Data field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetData

`func (o *SendPresence200Response) SetData(v SendPresence200ResponseData)`

SetData sets Data field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


