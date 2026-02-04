# SendLocationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**to** | **str** | Recipient | 
**latitude** | **float** | Latitude | 
**longitude** | **float** | Longitude | 
**name** | **str** | Location name | [optional] 
**address** | **str** | Address | [optional] 

## Example

```python
from omni_generated.models.send_location_request import SendLocationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendLocationRequest from a JSON string
send_location_request_instance = SendLocationRequest.from_json(json)
# print the JSON string representation of the object
print(SendLocationRequest.to_json())

# convert the object into a dict
send_location_request_dict = send_location_request_instance.to_dict()
# create an instance of SendLocationRequest from a dict
send_location_request_from_dict = SendLocationRequest.from_dict(send_location_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


